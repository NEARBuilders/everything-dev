import type { BosConfigInput, RuntimeConfig } from "../../types";
import { getPlatformManifestKey } from "../platform/manifest";
import {
  type ConfigHistoryEntry,
  fetchBosConfigFromFastKv,
  fetchConfigHistory,
} from "../registry/fastkv";
import { verifyBootPayload } from "../resolution/boot-check";
import { buildRollbackPayload, verifyRollbackSnapshot } from "./rollback";
import { type DeployTrainInput, publishToFastKv } from "./train";

/**
 * The shared rollback flow (ticket #422): the post-publish smoke failure
 * protocol and the `bos rollback` command both stamp `rolledBackFrom` onto
 * the target snapshot and republish it verbatim (`exactPayload`) — one
 * implementation here; the callers differ only in how they pick and vet the
 * target (the command's two-stage verification with --force; the smoke
 * protocol's simple refusal).
 */

export interface RollbackSnapshotInput {
  account: string;
  domain: string;
  env: "production" | "staging";
  runtimeConfig: RuntimeConfig | null;
  configDir: string;
  registry?: string;
  network?: "mainnet" | "testnet";
  privateKey?: string;
  wallet?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
}

export interface RollbackSnapshotOutcome {
  ok: boolean;
  registryUrl: string;
  txHash?: string;
  /** the caller passed dryRun — the snapshot was validated but not published */
  dryRun?: boolean;
  error?: string;
}

export async function fetchRollbackHistory(input: {
  account: string;
  domain: string;
  registry?: string;
  limit: number;
}): Promise<ConfigHistoryEntry[]> {
  return fetchConfigHistory({
    accountId: input.account,
    gatewayId: input.domain,
    registry: input.registry,
    limit: input.limit,
  });
}

/** The live config, or undefined when the registry read fails (an unknown
 * live state never blocks a rollback — the snapshot publish is idempotent). */
export async function fetchLiveConfig(input: {
  account: string;
  domain: string;
  registry?: string;
}): Promise<unknown> {
  try {
    return await fetchBosConfigFromFastKv<unknown>(
      `bos://${input.account}/${input.domain}`,
      input.registry,
    );
  } catch {
    return undefined;
  }
}

export function isSnapshotLive(targetValue: unknown, liveValue: unknown): boolean {
  return JSON.stringify(liveValue) === JSON.stringify(targetValue);
}

/** Stamp + republish the target snapshot verbatim. Callers own verification:
 * the smoke protocol refuses unverified targets via
 * `rollbackToPreviousSnapshot`; the command runs its two-stage check and
 * passes `skipVerify` once it has vetted (or --forced) the snapshot. */
export async function publishRollbackSnapshot(
  targetValue: unknown,
  input: RollbackSnapshotInput,
  opts?: { skipVerify?: boolean; restorePlatformPointer?: { key: string; value: string } },
): Promise<RollbackSnapshotOutcome> {
  if (!opts?.skipVerify) {
    const verification = await verifyRollbackSnapshot(targetValue as BosConfigInput);
    if (!verification.ok && verification.verifiable) {
      return {
        ok: false,
        registryUrl: "",
        error: "rollback refused — a pinned slot's bytes are gone or no longer match their SRI",
      };
    }
  }

  // The boot verdict is never skippable — skipVerify only stands down the
  // pin/byte verification (the rollback command vets bytes itself before
  // passing it), and no other vetting covers boot-ability.
  const bootCheck = await verifyBootPayload(
    targetValue,
    { account: input.account, gateway: input.domain },
    { ...(input.registry ? { registry: input.registry } : {}) },
  );
  if (!bootCheck.ok) {
    const detail = bootCheck.issues
      .map((issue) => `${issue.path ? `${issue.path}: ` : ""}${issue.message}`)
      .join("; ");
    const chainNote =
      bootCheck.chain.length > 0 ? ` (extends chain: ${bootCheck.chain.join(" -> ")})` : "";
    return {
      ok: false,
      registryUrl: "",
      error: `rollback refused — the target snapshot would not boot${chainNote}: ${detail}`,
    };
  }

  // Stamp the raw snapshot verbatim — the historical parse here was both a
  // crash (host-less child snapshots have no app.host of their own) and
  // lossy (Zod's strip mode dropped keys the schema didn't know); a
  // rollback's whole value proposition is byte-faithful republication.
  const payload = buildRollbackPayload(targetValue as BosConfigInput, new Date().toISOString());
  const result = await publishToFastKv({
    // The declared input type is the parsed BosConfig; the runtime payload is
    // the raw snapshot — the same declared-vs-runtime split the train's
    // exactPayload branch documents (train.ts exactPayload).
    bosConfig: payload as unknown as DeployTrainInput["bosConfig"],
    runtimeConfig: input.runtimeConfig,
    configDir: input.configDir,
    env: input.env,
    build: false,
    dryRun: input.dryRun ?? false,
    verbose: input.verbose ?? false,
    packages: "all",
    network: input.network,
    privateKey: input.privateKey,
    wallet: input.wallet ?? false,
    registry: input.registry,
    exactPayload: true,
    ...(opts?.restorePlatformPointer
      ? { restorePlatformPointer: opts.restorePlatformPointer }
      : {}),
  });
  if (result.status === "dry-run") {
    return { ok: true, registryUrl: result.registryUrl, dryRun: true };
  }
  if (result.status === "error") {
    return {
      ok: false,
      registryUrl: result.registryUrl,
      error: `rollback publish failed: ${result.error ?? result.status}`,
    };
  }
  return { ok: true, registryUrl: result.registryUrl, txHash: result.txHash };
}

/** The platform-pointer restore for a rollback (#573): the pointer's own
 * history[1] is the pre-release manifest — the same "previous entry" logic
 * the config rollback uses. Best-effort: a failed lookup returns undefined
 * and the drift alarm (#571's cross-check) catches any residue loudly. */
export async function resolvePointerRestore(
  account: string,
  domain: string,
  registry?: string,
): Promise<{ key: string; value: string } | undefined> {
  try {
    const pointerHistory = await fetchConfigHistory({
      accountId: account,
      gatewayId: domain,
      registry,
      limit: 5,
      keyPath: "platform.json",
    });
    const previousPointer = pointerHistory[1];
    if (!previousPointer) return undefined;
    return {
      key: getPlatformManifestKey(account, domain),
      value: JSON.stringify(previousPointer.value),
    };
  } catch {
    console.warn("  platform pointer restore unavailable — the drift alarm will catch any residue");
    return undefined;
  }
}

/** The post-publish smoke failure protocol (ADR 0021): roll the registry
 * config back to the previous snapshot — a red boot gate must never leave a
 * new config live against an old image. #573: the platform pointer rolls
 * back in the same atomic write. */
export async function rollbackToPreviousSnapshot(input: RollbackSnapshotInput): Promise<{
  ok: boolean;
  txHash?: string;
  blockHeight?: string;
  registryUrl: string;
  error?: string;
}> {
  let history: ConfigHistoryEntry[];
  try {
    history = await fetchRollbackHistory({
      account: input.account,
      domain: input.domain,
      registry: input.registry,
      limit: 20,
    });
  } catch (error) {
    return {
      ok: false,
      registryUrl: "",
      error: `fetching publish history failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const previous = history[1];
  if (!previous) {
    return {
      ok: false,
      registryUrl: "",
      error: "no previous snapshot in the publish history — nothing to roll back to",
    };
  }

  // The pointer restore mirrors the config rollback: the pointer's history[1]
  // is the pre-release manifest. Best-effort — a failed restore leaves the
  // drift alarm to catch the residue loudly.
  const restorePlatformPointer = await resolvePointerRestore(
    input.account,
    input.domain,
    input.registry,
  );

  const result = await publishRollbackSnapshot(previous.value, input, {
    restorePlatformPointer,
  });
  if (result.ok) {
    return {
      ok: true,
      blockHeight: String(previous.blockHeight),
      registryUrl: result.registryUrl,
      txHash: result.txHash,
    };
  }
  return result;
}
