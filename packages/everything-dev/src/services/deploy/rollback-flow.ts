import {
  type ConfigHistoryEntry,
  fetchBosConfigFromFastKv,
  fetchConfigHistory,
} from "../../fastkv";
import { buildRollbackPayload, verifyRollbackSnapshot } from "../../rollback";
import { type BosConfigInput, BosConfigSchema, type RuntimeConfig } from "../../types";
import { publishToFastKv } from "./train";

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
}): Promise<unknown | undefined> {
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
  opts?: { skipVerify?: boolean },
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

  const payload = buildRollbackPayload(
    BosConfigSchema.parse(targetValue),
    new Date().toISOString(),
  );
  const result = await publishToFastKv({
    bosConfig: payload,
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

/** The post-publish smoke failure protocol (ADR 0021): roll the registry
 * config back to the previous snapshot — a red boot gate must never leave a
 * new config live against an old image. */
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

  const result = await publishRollbackSnapshot(previous.value, input);
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
