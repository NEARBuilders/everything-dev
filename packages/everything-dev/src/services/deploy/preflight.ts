import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { selectWorkspaceTargets } from "../../services/workspace/build-train";
import type { BosConfig, PublishConfig } from "../../types";
import { fetchResponse } from "../../utils/http-client";
import { getNetworkIdForAccount } from "../../utils/network";
import { colors } from "../../utils/theme";
import {
  checkPublishBalance,
  checkPublishKeyHealth,
  describeSigningStrategy,
  resolveSigningStrategy,
  type SigningStrategy,
} from "../auth/near-signer";
import type { CustodyWalletRecord, SessionCredential } from "../auth/session";
import { readSessionHandle } from "../auth/session";
import {
  buildRegistryConfigUrlForNetwork,
  fetchPublishedConfigFromFastKv,
  getRegistryNamespaceForAccount,
  getRegistryNamespaceForNetwork,
  type NetworkId,
} from "../registry/fastkv";
import { type CdnDeployInputs, probeStorageOrigin, resolveCdnDeployInputs } from "./cdn";

/**
 * Pure publish preflight (resolve, don't mutate) — every failure returns
 * before the build train runs (issue #287). Dry-run exits after the auth
 * guards, before any signing (keychain/TTY side effects).
 *
 * The validated auth handles are captured on the plan (guards once per run,
 * ticket #422): the train's submit phase consumes `plan.custodyWallet` /
 * `plan.credential` instead of re-reading and re-validating the session file.
 */

export type PublishedConfigState = "fetched" | "missing" | "unreachable";

export interface PublishPreflightPlan {
  isStaging: boolean;
  account: string;
  gateway: string;
  network: NetworkId;
  registryUrl: string;
  registryNamespace: string;
  targets: string[];
  useWallet: boolean;
  useCustody: boolean;
  strategy?: SigningStrategy;
  cdnOrigin: string | undefined;
  storageOrigin: string;
  storageApiKey?: string;
  /** The config currently published to FastKV (null when missing or unreachable). */
  publishedConfig: Record<string, unknown> | null;
  /** Whether the preflight FastKV read succeeded, found nothing, or failed. */
  publishedConfigState: PublishedConfigState;
  /** Validated by the custody guard — present iff useCustody. */
  custodyWallet?: CustodyWalletRecord;
  /** Validated by the session guard — present iff useWallet. */
  credential?: SessionCredential;
}

export type PublishPreflight =
  | { kind: "dry-run"; registryUrl: string }
  | { kind: "error"; registryUrl: string; error: string }
  | { kind: "ready"; plan: PublishPreflightPlan };

const FRAMEWORK_PACKAGE_NAMES = ["better-near-auth", "every-plugin", "everything-dev"] as const;

/**
 * Whether npm serves `name@version` (true), definitively does not (404 —
 * false), or whether publishability could not be determined (network error,
 * unexpected status — null; callers must not block on that).
 */
export async function npmVersionPublished(
  name: string,
  version: string,
  options: { bustCache?: boolean } = {},
): Promise<boolean | null> {
  try {
    // Cache-buster query on the polled path: the registry CDN read-serves
    // <name>/<version> endpoints, so a freshly published version can 404
    // from a stale edge cache; a unique query string always misses it.
    const suffix = options.bustCache ? `?bust=${Date.now()}-${Math.random()}` : "";
    const res = await fetchResponse(`https://registry.npmjs.org/${name}/${version}${suffix}`, {
      headers: { Accept: "application/json" },
    });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * The npm-publish gate: a workspace that vendors the framework packages'
 * sources must not ship bundles ahead of npm — the update check, child
 * scaffolds (`bos init`), and template syncs all read those versions from
 * the registry. Reads only apply when the sources are workspace-local (the
 * parent repo); child projects install the framework from npm and are
 * inherently in sync.
 */
export async function findUnpublishedFrameworkPackages(
  configDir: string,
  options: { probe?: (name: string, version: string) => Promise<boolean | null> } = {},
): Promise<Array<{ name: string; version: string }>> {
  const probe = options.probe ?? npmVersionPublished;
  const results = await probePackages(readFrameworkPackageManifests(configDir), probe);
  return results
    .filter((entry) => entry.state === false)
    .map((entry) => ({ name: entry.pkg.name, version: entry.pkg.version }));
}

interface FrameworkManifest {
  name: (typeof FRAMEWORK_PACKAGE_NAMES)[number];
  version: string;
}

function readFrameworkPackageManifests(configDir: string): Array<FrameworkManifest> {
  const manifests: Array<FrameworkManifest> = [];
  for (const name of FRAMEWORK_PACKAGE_NAMES) {
    const manifestPath = join(configDir, "packages", name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const version = (JSON.parse(readFileSync(manifestPath, "utf-8")) as { version?: string })
      .version;
    if (version) manifests.push({ name, version });
  }
  return manifests;
}

/** A manifest npm does not (yet) serve, as tracked by the wait loop. */
interface UnpublishedPackage {
  name: string;
  version: string;
}

export interface FrameworkPublishWaitOptions {
  /** Poll cadence. Default 15s. */
  intervalMs?: number;
  /** Total time to wait for the Release train's publish. Default 15 min. */
  budgetMs?: number;
  /** Injectable sleep (unit tests fast-forward the wait). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (unit tests drive the budget deterministically). */
  now?: () => number;
  /** Injectable registry probe (unit tests bypass the network). */
  probe?: (name: string, version: string) => Promise<boolean | null>;
}

export type FrameworkPublishWait = { kind: "ok" } | { kind: "error"; error: string };

const DEFAULT_PUBLISH_WAIT = { intervalMs: 15_000, budgetMs: 15 * 60_000 };

/**
 * Waits out the Deploy/Release race on version-bump merges: both trains
 * trigger on the same push, and the Release workflow needs minutes to
 * publish the bumped versions. Instead of refusing (bundles never ship
 * ahead of the registry — that invariant stands), preflight parks here
 * until every workspace framework version is on npm, up to a bounded
 * budget; a timeout keeps the original fail-loud behavior with a pointer
 * at the Release run.
 */
export async function waitForFrameworkPackages(
  configDir: string,
  options: FrameworkPublishWaitOptions = {},
): Promise<FrameworkPublishWait> {
  const intervalMs = options.intervalMs ?? DEFAULT_PUBLISH_WAIT.intervalMs;
  const budgetMs = options.budgetMs ?? DEFAULT_PUBLISH_WAIT.budgetMs;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const probe =
    options.probe ?? ((name, version) => npmVersionPublished(name, version, { bustCache: true }));

  const manifests = readFrameworkPackageManifests(configDir);
  if (manifests.length === 0) return { kind: "ok" };

  const listing = (packages: Array<UnpublishedPackage>) =>
    packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ");

  const states = await probePackages(manifests, probe);
  if (states.every((entry) => entry.state === true)) return { kind: "ok" };
  let pending = states.filter((entry) => entry.state === false).map((entry) => entry.pkg);

  console.log(
    `  Waiting for the Release workflow to publish ${colors.cyan(listing(pending))} to npm ` +
      `(polling every ${Math.round(intervalMs / 1000)}s, budget ${Math.round(budgetMs / 60_000)} min)`,
  );

  const startedAt = now();
  const deadline = startedAt + budgetMs;
  let lastProgressLog = startedAt;
  while (true) {
    await sleep(intervalMs);
    const results = await probePackages(pending, probe);
    for (const entry of results.filter((check) => check.state === true)) {
      console.log(`  ✓ ${entry.pkg.name}@${entry.pkg.version} published`);
    }
    pending = results.filter((check) => check.state === false).map((check) => check.pkg);
    if (pending.length === 0) {
      console.log("  ✓ framework packages cleared the npm gate — resuming the deploy train");
      return { kind: "ok" };
    }
    if (now() >= deadline) {
      return {
        kind: "error",
        error:
          `Framework package(s) ${listing(pending)} were not published to npm within ` +
          `${Math.round(budgetMs / 60_000)} min — deploys must not ship bundles ahead of the ` +
          "registry (child scaffolds and update checks read these versions). The Release " +
          "workflow for this commit may still be publishing or may have failed — check its " +
          "run, then re-run the deploy once the packages are on npm.",
      };
    }
    if (now() - lastProgressLog >= 60_000) {
      lastProgressLog = now();
      console.log(
        `  Still unpublished: ${listing(pending)} (${Math.round((now() - startedAt) / 1000)}s elapsed)`,
      );
    }
  }
}

async function probePackages(
  packages: Array<UnpublishedPackage>,
  probe: (name: string, version: string) => Promise<boolean | null>,
): Promise<Array<{ pkg: UnpublishedPackage; state: boolean | null }>> {
  const results: Array<{ pkg: UnpublishedPackage; state: boolean | null }> = [];
  for (const pkg of packages) {
    const state = await probe(pkg.name, pkg.version);
    if (state === null) {
      // Original gate semantics: an unverifiable state never blocks the
      // deploy (registry outage stays a warn-and-continue path).
      console.log(
        colors.yellow(
          `  ! Could not verify ${pkg.name}@${pkg.version} on npm (registry unreachable) — continuing`,
        ),
      );
    }
    results.push({ pkg, state });
  }
  return results;
}

interface PreflightInput {
  bosConfig: BosConfig;
  configDir: string;
  env: "production" | "staging";
  build: boolean;
  dryRun: boolean;
  packages: string;
  network?: "mainnet" | "testnet";
  privateKey?: string;
  wallet?: boolean;
  registry?: string;
}

export async function preflightPublish(input: PreflightInput): Promise<PublishPreflight> {
  const { configDir } = input;
  const bosConfig = input.bosConfig;

  const isStaging = input.env === "staging";
  const account = isStaging ? (bosConfig.staging?.account ?? bosConfig.account) : bosConfig.account;
  const gateway = isStaging ? (bosConfig.staging?.domain ?? bosConfig.domain) : bosConfig.domain;
  if (!gateway) {
    return {
      kind: "error",
      registryUrl: "",
      error: "authored config must define domain to publish",
    };
  }

  const network: NetworkId = input.network ?? getNetworkIdForAccount(account);
  const registryUrl = buildRegistryConfigUrlForNetwork(network, account, gateway, input.registry);
  const fail = (error: string): PublishPreflight => ({ kind: "error", registryUrl, error });

  // One session-file read for the whole run (guards once, ticket #422): the
  // wallet/custody guards validate + capture their handles on the plan, and
  // CDN credential derivation consumes the raw credential as before.
  const sessionFile = readSessionHandle(configDir);
  const publishAuth: PublishConfig["auth"] = bosConfig.publish?.auth;
  const governsWalletPublish = (publishAuth === "session" || input.wallet) && !input.privateKey;
  let credential: SessionCredential | undefined;
  if (governsWalletPublish) {
    if (!sessionFile?.credential) {
      return fail(
        (input.wallet
          ? "--wallet requires"
          : 'the authored config sets publish.auth = "session", but') +
          " no CLI session is stored in .bos/ for this project. Run bos login to create one.",
      );
    }
    if (sessionFile.credential.accountId && sessionFile.credential.accountId !== account) {
      return fail(
        `The CLI session was created for ${sessionFile.credential.accountId}, but the configured ` +
          `account is ${account}. Gasless wallet publish relays the FastKV write under the session's ` +
          "NEAR account. Run bos login again under the matching account.",
      );
    }
    credential = sessionFile.credential;
  }
  const useCustody = publishAuth === "custody" && !input.privateKey && !input.wallet;
  let custodyWallet: CustodyWalletRecord | undefined;
  if (useCustody) {
    const wallet = sessionFile?.custodyWallet;
    if (!wallet) {
      return fail(
        'the authored config sets publish.auth = "custody", but no custody wallet is stored in ' +
          ".bos/. Run `bos login --custody` first.",
      );
    }
    if (wallet.network !== network) {
      return fail(
        `The custody wallet was registered on ${wallet.network}, but this project publishes ` +
          `on ${network}. Run \`bos login --custody\` from a ${network} account.`,
      );
    }
    if (wallet.nearAccountId !== account) {
      return fail(
        `publish.auth = "custody" publishes under the custody wallet's account, but the configured ` +
          `account is ${account} and the custody wallet account is ${wallet.nearAccountId}. ` +
          "Set the authored config's account to the custody wallet account.",
      );
    }
    custodyWallet = wallet;
  }

  if (input.dryRun) {
    return { kind: "dry-run", registryUrl };
  }

  const useWallet = input.wallet === true;
  let strategy: SigningStrategy | undefined;
  if (useWallet) {
    console.log(
      `  Signing via ${colors.cyan("gasless NEP-366 delegate action (relayed by the platform relayer)")}`,
    );
  } else {
    try {
      strategy = await resolveSigningStrategy({ privateKey: input.privateKey, account, network });
      console.log(`  Signing via ${colors.cyan(describeSigningStrategy(strategy))}`);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Unknown error");
    }
    // The publish key's on-chain health is checked before the build train so a
    // rotated or exhausted key fails in seconds with the repair hint instead
    // of surfacing after a full build as a broadcast that never appears
    // on-chain.
    if (strategy.strategy === "near-kit") {
      const health = await checkPublishKeyHealth({
        account,
        contract: getRegistryNamespaceForAccount(account, input.registry),
        privateKey: strategy.privateKey,
        network,
      });
      if (health.warning) {
        console.log(colors.dim(`  ${health.warning}`));
      }
      if (health.error) {
        return fail(health.error);
      }
      // The publish account must hold the prepayment lock (attached gas at
      // the worst-case gas price) or every broadcast is rejected at admission
      // and surfaces only as a silent "dropped at broadcast" after a full
      // build — checked here so a low balance fails in seconds with the
      // exact top-up numbers.
      const balance = await checkPublishBalance({ account, network });
      if (balance.warning) {
        console.log(colors.dim(`  ${balance.warning}`));
      }
      if (balance.error) {
        return fail(balance.error);
      }
    }
  }

  // CDN deploy credentials (ADR 0020) — resolved before the build train so a
  // missing bundle origin or BOS_STORAGE_API_KEY fails fast instead of after
  // the full build. Config-only publishes ship the committed config verbatim;
  // nothing is uploaded, so no deploy origins are required.
  let cdnDeploy: CdnDeployInputs = {
    cdnOrigin: undefined,
    storageOrigin: "",
    apiKey: undefined,
  };
  if (input.build) {
    const wait = await waitForFrameworkPackages(configDir);
    if (wait.kind === "error") {
      return fail(wait.error);
    }

    cdnDeploy = resolveCdnDeployInputs({
      env: process.env as Record<string, string | undefined>,
      bosConfig,
      session: sessionFile?.credential ?? null,
      custodyAccount: useCustody ? custodyWallet?.nearAccountId : undefined,
      account,
      gateway,
      uploadsPlanned: input.build,
    });
    if (cdnDeploy.error) {
      return fail(cdnDeploy.error);
    }
    if (cdnDeploy.warning) {
      console.log(colors.yellow(`  ! ${cdnDeploy.warning}`));
    }
    const cdnOrigin = cdnDeploy.cdnOrigin;
    if (!cdnOrigin) {
      return fail("CDN deploy resolved no bundle origin");
    }
    const probeError = await probeStorageOrigin(cdnDeploy.storageOrigin);
    if (probeError) {
      return fail(
        `The bundle upload origin ${cdnDeploy.storageOrigin} is not running the platform API — ` +
          `${probeError}. Check BOS_STORAGE_ORIGIN / the bos login session, then re-run.`,
      );
    }
  }

  // Registry reachability + published-state capture: one FastKV read. A
  // missing config is fine for a first publish — an early signal, not a hard
  // gate. The captured config is the merge base for a config-only publish on
  // a TS-form project (authored hand-edits win; live pipeline state carries).
  let publishedConfig: Record<string, unknown> | null = null;
  let publishedConfigState: PublishedConfigState = "missing";
  try {
    publishedConfig = await fetchPublishedConfigFromFastKv<Record<string, unknown>>(registryUrl);
    publishedConfigState = "fetched";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("No config found")) {
      console.log(colors.dim("  Note: no published config found yet (first publish) — continuing"));
    } else {
      publishedConfigState = "unreachable";
      console.log(colors.dim("  Note: registry read failed — continuing"));
    }
  }

  return {
    kind: "ready",
    plan: {
      isStaging,
      account,
      gateway,
      network,
      registryUrl,
      registryNamespace: getRegistryNamespaceForNetwork(network, input.registry),
      targets: selectWorkspaceTargets(input.packages, bosConfig),
      useWallet,
      useCustody,
      strategy,
      cdnOrigin: cdnDeploy.cdnOrigin,
      storageOrigin: cdnDeploy.storageOrigin,
      storageApiKey: cdnDeploy.apiKey,
      publishedConfig,
      publishedConfigState,
      ...(custodyWallet ? { custodyWallet } : {}),
      ...(credential ? { credential } : {}),
    },
  };
}
