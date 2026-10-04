import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { hasFolderFormUi } from "every-plugin/build/ui";
import { readSessionHandle } from "./auth-session";
import { buildWorkspaceTargets, resolveWorkspaceTarget, selectWorkspaceTargets } from "./build";
import { type CdnDeployInputs, probeStorageOrigin, resolveCdnDeployInputs } from "./cdn-deploy";
import { formatDuration } from "./cli/timing";
import { generateCodeArtifacts } from "./code-artifacts";
import { findConfigPath, isAppDescriptorPath, resolveUiRuntimeName } from "./config";
import type { WorkspaceDeployResult } from "./contract";
import { ensureDelegateKey, submitRegistryWriteDelegated } from "./delegate-signer";
import {
  buildRegistryConfigUrlForNetwork,
  fetchBosConfigFromFastKv,
  getRegistryNamespaceForNetwork,
  type NetworkId,
} from "./fastkv";
import { pointerFingerprint, slotPins } from "./fingerprint";
import { applyDeployResults, type DeployResultEntry } from "./integrity";
import { mergeAuthoredOverPublished } from "./merge";
import {
  describeSigningStrategy,
  resolveSigningStrategy,
  type SigningStrategy,
  submitRegistryWrite,
} from "./near-signer";
import { getNetworkIdForAccount } from "./network";
import { platformUrlDeployEntries, pluginUiUrlDeployEntries } from "./platform-deploy";
import { openResolution } from "./resolution/session";
import { collectDistFiles, uploadBundle, uploadWorkspaceDist } from "./storage-upload";
import type { BosConfig, BosConfigInput, PublishConfig, RuntimeConfig } from "./types";
import { padRight } from "./utils/string";
import { colors, icons } from "./utils/theme";
import { composeWorkspaceVersionManifest, readBuildReport } from "./version-manifest-deploy";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compose + upload the workspace's version manifest (atomic-deploys 03): the
 * manifest is built from the dist build report + the **server-computed** SRI
 * map of the just-finished upload, uploaded additively at
 * `versions/<version>.json`, and returned as the slot's pointer. Returns
 * undefined when the dist predates hashed entry names (no report / no entry
 * SRI) — the caller aborts the train: uploaded workspaces must pin.
 */
async function pinWorkspaceVersionManifest(input: {
  origin: string;
  apiKey?: string;
  account: string;
  gateway: string;
  workspace: string;
  report: ReturnType<typeof readBuildReport>;
  ssrReport: ReturnType<typeof readBuildReport>;
  integrityMap: Record<string, string>;
}): Promise<{ file: string; integrity: string } | undefined> {
  if (!input.report) return undefined;
  const versionManifest = composeWorkspaceVersionManifest({
    report: input.report,
    ssrReport: input.ssrReport,
    integrityMap: input.integrityMap,
  });
  if (!versionManifest) return undefined;

  const manifestFile = `versions/${versionManifest.version}.json`;
  const manifestUpload = await uploadBundle({
    origin: input.origin,
    apiKey: input.apiKey,
    account: input.account,
    gateway: input.gateway,
    workspace: input.workspace,
    files: [
      {
        path: manifestFile,
        bytes: new TextEncoder().encode(`${JSON.stringify(versionManifest, null, 2)}\n`),
      },
    ],
  });
  const manifestIntegrity = manifestUpload.integrity[manifestFile];
  if (!manifestIntegrity) return undefined;
  console.log(
    `    ${colors.dim(`${padRight("", 28)} version manifest ${manifestFile} (SRI pinned)`)}`,
  );
  return { file: manifestFile, integrity: manifestIntegrity };
}

function formatBundleMb(files: Array<{ bytes: Uint8Array }>): string {
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  return `${(total / 1024 / 1024).toFixed(1)} MB`;
}

export async function waitForPublishedConfig(opts: {
  account: string;
  gateway: string;
  publishConfig: BosConfigInput;
  registry?: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<void> {
  const envTimeoutMs = Number(process.env.BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS);
  const envIntervalMs = Number(process.env.BOS_PUBLISH_CONFIRMATION_INTERVAL_MS);
  const timeoutMs =
    opts.timeoutMs ?? (Number.isFinite(envTimeoutMs) ? envTimeoutMs : undefined) ?? 120_000;
  const intervalMs =
    opts.intervalMs ?? (Number.isFinite(envIntervalMs) ? envIntervalMs : undefined) ?? 3_000;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const verifiedConfig = await fetchBosConfigFromFastKv<BosConfigInput>(
        `bos://${opts.account}/${opts.gateway}`,
        opts.registry,
      );

      if (JSON.stringify(verifiedConfig) === JSON.stringify(opts.publishConfig)) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  const reason = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(
    `Timed out waiting for publish confirmation at bos://${opts.account}/${opts.gateway}.${reason}`,
  );
}

export async function isConfigAlreadyPublished(opts: {
  account: string;
  gateway: string;
  publishConfig: BosConfigInput;
  registry?: string;
}): Promise<boolean> {
  try {
    const current = await fetchBosConfigFromFastKv<BosConfigInput>(
      `bos://${opts.account}/${opts.gateway}`,
      opts.registry,
    );
    return JSON.stringify(current) === JSON.stringify(opts.publishConfig);
  } catch {
    return false;
  }
}

interface PublishToFastKvInput {
  bosConfig: BosConfig;
  runtimeConfig: RuntimeConfig | null;
  configDir: string;
  env: "production" | "staging";
  build: boolean;
  dryRun: boolean;
  verbose: boolean;
  packages: string;
  network?: "mainnet" | "testnet";
  privateKey?: string;
  wallet?: boolean;
  registry?: string;
}

interface PublishToFastKvResult {
  status: "published" | "error" | "dry-run";
  registryUrl: string;
  txHash?: string;
  built?: string[];
  skipped?: string[];
  error?: string;
  publishConfig?: BosConfigInput;
  deployResults?: WorkspaceDeployResult[];
  fingerprint?: string;
  slotPins?: Record<string, string>;
}

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
  strategy?: SigningStrategy;
  cdnOrigin: string | undefined;
  storageOrigin: string;
  storageApiKey?: string;
  /** The config currently published to FastKV (null when missing or unreachable). */
  publishedConfig: Record<string, unknown> | null;
  /** Whether the preflight FastKV read succeeded, found nothing, or failed. */
  publishedConfigState: PublishedConfigState;
}

export type PublishPreflight =
  | { kind: "dry-run"; registryUrl: string }
  | { kind: "error"; registryUrl: string; error: string }
  | { kind: "ready"; plan: PublishPreflightPlan };

// Pure preflight (resolve, don't mutate) — every failure returns before the
// build train runs (issue #287). Dry-run exits after the auth guards, before
// any signing (keychain/TTY side effects).
export async function preflightPublish(input: PublishToFastKvInput): Promise<PublishPreflight> {
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

  const publishAuth: PublishConfig["auth"] = bosConfig.publish?.auth;
  const governsWalletPublish = (publishAuth === "session" || input.wallet) && !input.privateKey;
  if (governsWalletPublish) {
    const session = readSessionHandle(configDir);
    if (!session?.credential) {
      return fail(
        (input.wallet
          ? "--wallet requires"
          : 'the authored config sets publish.auth = "session", but') +
          " no CLI session is stored in .bos/ for this project. Run bos login to create one.",
      );
    }
    if (session.credential.accountId && session.credential.accountId !== account) {
      return fail(
        `The CLI session was created for ${session.credential.accountId}, but the configured ` +
          `account is ${account}. Gasless wallet publish relays the FastKV write under the session's ` +
          "NEAR account. Run bos login again under the matching account.",
      );
    }
  }
  if (publishAuth && !input.privateKey) {
    if (publishAuth === "custody") {
      return fail(
        'the authored config sets publish.auth = "custody", but custody publish is not implemented yet (see NEARBuilders/everything-dev#291).',
      );
    }
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
  }

  // CDN deploy credentials (ADR 0020) — resolved before the build train so a
  // missing bundle origin or BOS_STORAGE_API_KEY fails fast instead of after
  // the full build. Config-only publishes ship the committed config verbatim;
  // nothing is uploaded, so no deploy origins are required.
  const session = readSessionHandle(configDir);
  let cdnDeploy: CdnDeployInputs = {
    cdnOrigin: undefined,
    storageOrigin: "",
    apiKey: undefined,
  };
  if (input.build) {
    cdnDeploy = resolveCdnDeployInputs({
      env: process.env as Record<string, string | undefined>,
      bosConfig,
      session: session?.credential ?? null,
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
    publishedConfig = await fetchBosConfigFromFastKv<Record<string, unknown>>(
      registryUrl,
      input.registry,
    );
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
      strategy,
      cdnOrigin: cdnDeploy.cdnOrigin,
      storageOrigin: cdnDeploy.storageOrigin,
      storageApiKey: cdnDeploy.apiKey,
      publishedConfig,
      publishedConfigState,
    },
  };
}

/**
 * The deploy-train publish core (ADR 0020, as amended): preflight
 * (storage/CDN creds + signing) fails fast before the build, then build →
 * upload → version-manifest pin → config write-back → FastKV publish +
 * read-back. Scoped to one plugin via `packages`, a single-plugin redeploy
 * ships real bytes to the storage origin — same as the full train, nothing
 * image-native left.
 */
export async function publishToFastKv(input: PublishToFastKvInput): Promise<PublishToFastKvResult> {
  const preflight = await preflightPublish(input);
  if (preflight.kind === "error") {
    return { status: "error", registryUrl: preflight.registryUrl, error: preflight.error };
  }
  if (preflight.kind === "dry-run") {
    return { status: "dry-run", registryUrl: preflight.registryUrl };
  }
  const plan = preflight.plan;
  const {
    isStaging,
    account,
    gateway,
    network,
    registryUrl,
    registryNamespace,
    targets,
    useWallet,
    strategy,
  } = plan;
  const storageOrigin = plan.storageOrigin;
  const storageApiKey = plan.storageApiKey;

  const { configDir } = input;
  let bosConfig = input.bosConfig;
  const runtimeConfig = input.runtimeConfig;
  let built: string[] | undefined;
  let skipped: string[] | undefined;
  let deployResults: WorkspaceDeployResult[] | undefined;
  let refreshedRawConfig: BosConfigInput | null = null;

  if (input.build) {
    await generateCodeArtifacts(configDir, bosConfig, {
      env: "production",
      runtimeConfig: runtimeConfig ?? undefined,
    });

    const result = await buildWorkspaceTargets({
      configDir,
      bosConfig,
      runtimeConfig,
      targets,
      deploy: true,
      verbose: input.verbose,
    });
    built = result.built;
    skipped = result.skipped;
    deployResults = result.deployResults;

    if (deployResults) {
      const failures = deployResults.filter((r) => !r.success);
      if (failures.length > 0) {
        const total = deployResults.length;
        console.log();
        console.log(
          colors.error(
            `  ${icons.err} Deploy failed — ${failures.length} of ${total} workspace${total > 1 ? "s" : ""} failed`,
          ),
        );
        console.log();
        for (const f of failures) {
          const errorLine = (f.error ?? "Failed").split("\n")[0];
          console.log(`    ${colors.error(icons.err)} ${padRight(f.key, 28)} ${errorLine}`);
        }
        console.log();
        if (!input.verbose) {
          console.log(colors.dim("  Run with --verbose for full build output."));
          console.log();
        }
        return {
          status: "error" as const,
          registryUrl,
          built,
          skipped,
          deployResults,
          error: `${failures.length} of ${total} workspaces failed to deploy`,
        };
      }
    }

    const refreshed = await openResolution({ cwd: configDir });
    if (!refreshed?.config) {
      return {
        status: "error",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: "Failed to reload the config after build",
      };
    }

    bosConfig = refreshed.config;
    refreshedRawConfig = refreshed.rawConfig;
  }

  const authoredPath = findConfigPath(configDir);
  const tsForm = authoredPath !== null && isAppDescriptorPath(authoredPath);
  let rawConfig: BosConfigInput;
  if (refreshedRawConfig) {
    rawConfig = refreshedRawConfig;
  } else {
    const opened = await openResolution({ cwd: configDir });
    if (!opened?.rawConfig) {
      return {
        status: "error",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: "Failed to load the authored config for publish",
      };
    }
    rawConfig = opened.rawConfig;
  }
  if (tsForm && !input.build && plan.publishedConfigState === "unreachable") {
    // A config-only TS-form publish derives its pipeline state from the live
    // published config — publishing without it would wipe bundle URLs.
    return {
      status: "error",
      registryUrl,
      built,
      skipped,
      deployResults,
      error:
        "Cannot read the currently published config from the registry — a config-only publish would overwrite live bundle URLs. Retry when the registry is reachable, or run a full deploy.",
    };
  }
  let publishPayload: BosConfigInput =
    tsForm && !input.build
      ? // Config-only publish on a TS-form project: the authored config owns
        // composition (hand-edits win) while live pipeline state (bundle
        // URLs, integrity) carries over from the published config.
        mergeAuthoredOverPublished((plan.publishedConfig ?? {}) as BosConfigInput, rawConfig)
      : rawConfig;

  const urlOrigin = plan.cdnOrigin ?? `https://${gateway}`;
  const deployTargets = (built ?? []).filter((key) => targets.includes(key));
  const platformEntries: DeployResultEntry[] = [];

  console.log();
  console.log(`  CDN deploy — uploading workspace dists to ${storageOrigin}...`);
  for (const key of deployTargets) {
    const ws = resolveWorkspaceTarget(key, bosConfig, runtimeConfig, configDir);
    if (!ws) continue;

    const distFiles = await collectDistFiles(join(ws.path, "dist"));
    const totalMb = formatBundleMb(distFiles);
    console.log(
      `    ${padRight(key, 28)} uploading ${distFiles.length} files (${totalMb}) → ${urlOrigin}/bundles/${account}/${gateway}/${key}/`,
    );
    const startedAt = Date.now();
    // an upload failure aborts the train as a structured error — the
    // previously published version stays fully live (ticket 05)
    let result: Awaited<ReturnType<typeof uploadWorkspaceDist>>;
    try {
      result = await uploadWorkspaceDist({
        origin: storageOrigin,
        apiKey: storageApiKey,
        account,
        gateway,
        workspace: key,
        files: distFiles,
      });
    } catch (error) {
      return {
        status: "error",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: error instanceof Error ? error.message : `[publish] bundle upload for ${key} failed`,
      };
    }
    const report = readBuildReport(join(ws.path, "dist"));
    const ssrReport = readBuildReport(join(ws.path, "dist", "ssr"));
    // the entry SRI keyed by the build report's hashed name
    const integrity = report ? result.integrity[report.entry] : undefined;
    const ssrIntegrity = ssrReport?.entry ? result.integrity[`ssr/${ssrReport.entry}`] : undefined;
    const fileCount = result.stored;

    const manifestPointer = await pinWorkspaceVersionManifest({
      origin: storageOrigin,
      apiKey: storageApiKey,
      account,
      gateway,
      workspace: key,
      report,
      ssrReport,
      integrityMap: result.integrity,
    });
    if (!manifestPointer) {
      return {
        status: "error",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: `bundle upload for ${key}: version manifest missing — the dist predates hashed entry names (rebuild required; atomic-deploys hard break)`,
      };
    }

    if (result.storage === "memory") {
      return {
        status: "error",
        registryUrl,
        built,
        skipped,
        deployResults,
        error:
          "The receiving instance is serving bundle storage from memory (BOS_STORAGE_* R2 credentials are not configured there) — uploaded bytes would be lost on restart. Aborting before publish.",
      };
    }

    console.log(
      `    ${colors.green(icons.ok)} ${padRight(key, 28)} → ${urlOrigin}/bundles/${account}/${gateway}/${key}/ (${fileCount} files, ${formatDuration(Date.now() - startedAt)})`,
    );

    platformEntries.push(
      ...platformUrlDeployEntries({
        origin: urlOrigin,
        account,
        gateway,
        key,
        kind: ws.kind,
        integrity,
        ssrIntegrity,
        pin: manifestPointer,
      }),
    );

    // Folder-form plugin ui: the workspace build also produces <plugin>/ui/dist
    // (web remoteEntry + ssr container) — upload it as its own bundle key and
    // pin <slot>.<key>.ui.* so the host can compose the ui surface in production.
    if (hasFolderFormUi(ws.path)) {
      const uiDistDir = join(ws.path, "ui", "dist");
      const uiSlot = ws.kind === "app" ? "app" : "plugins";
      const rawSlot = (uiSlot === "app" ? rawConfig.app : rawConfig.plugins) as
        | Record<string, Record<string, unknown> | undefined>
        | undefined;
      const rawUi = rawSlot?.[key]?.ui as Record<string, unknown> | undefined;
      const uiName = resolveUiRuntimeName(rawUi, join(ws.path, "ui"), key);
      let uiIntegrity: string | undefined;
      let uiSsrIntegrity: string | undefined;
      let uiFileCount: number | undefined;
      let uiManifestPointer: { file: string; integrity: string } | undefined;
      if (existsSync(uiDistDir)) {
        const uiDistFiles = await collectDistFiles(uiDistDir);
        console.log(
          `    ${padRight(`${key}-ui`, 28)} uploading ${uiDistFiles.length} files (${formatBundleMb(uiDistFiles)}) → ${urlOrigin}/bundles/${account}/${gateway}/${key}-ui/`,
        );
        const uiStartedAt = Date.now();
        const uiResult = await uploadWorkspaceDist({
          origin: storageOrigin,
          apiKey: storageApiKey,
          account,
          gateway,
          workspace: `${key}-ui`,
          files: uiDistFiles,
        });
        const uiReport = readBuildReport(uiDistDir);
        const uiSsrReport = readBuildReport(join(uiDistDir, "ssr"));
        uiIntegrity = uiReport ? uiResult.integrity[uiReport.entry] : undefined;
        uiSsrIntegrity = uiSsrReport?.entry
          ? uiResult.integrity[`ssr/${uiSsrReport.entry}`]
          : undefined;
        uiFileCount = uiResult.stored;

        uiManifestPointer = await pinWorkspaceVersionManifest({
          origin: storageOrigin,
          apiKey: storageApiKey,
          account,
          gateway,
          workspace: `${key}-ui`,
          report: uiReport,
          ssrReport: uiSsrReport,
          integrityMap: uiResult.integrity,
        });
        if (!uiManifestPointer) {
          return {
            status: "error",
            registryUrl,
            built,
            skipped,
            deployResults,
            error: `bundle upload for ${key}-ui: version manifest missing — the dist predates hashed entry names (rebuild required; atomic-deploys hard break)`,
          };
        }

        console.log(
          `    ${colors.green(icons.ok)} ${padRight(`${key}-ui`, 28)} → ${urlOrigin}/bundles/${account}/${gateway}/${key}-ui/ (${uiFileCount} files, ${formatDuration(Date.now() - uiStartedAt)})`,
        );
      } else {
        console.log(
          `    ${colors.green(icons.ok)} ${padRight(`${key}-ui`, 28)} → ${urlOrigin}/bundles/${account}/${gateway}/${key}-ui/`,
        );
      }

      platformEntries.push(
        ...pluginUiUrlDeployEntries({
          origin: urlOrigin,
          account,
          gateway,
          key,
          kind: ws.kind,
          integrity: uiIntegrity,
          ssrIntegrity: uiSsrIntegrity,
          name: uiName,
          pin: uiManifestPointer,
        }),
      );
    }
  }

  if (platformEntries.length > 0) {
    const merged = applyDeployResults(rawConfig as Record<string, unknown>, platformEntries);
    if (!tsForm) {
      // Legacy JSON-form children keep their local write-back; TS-form keeps
      // pipeline state in FastKV only — a write-back would shadow the
      // authored bos.app.ts descriptor.
      try {
        writeFileSync(join(configDir, "bos.config.json"), `${JSON.stringify(merged, null, 2)}\n`);
      } catch (error) {
        return {
          status: "error",
          registryUrl,
          built,
          skipped,
          deployResults,
          error: `Failed to write bundle URLs to bos.config.json: ${error instanceof Error ? error.message : error}`,
        };
      }
    }
    publishPayload = merged as BosConfigInput;
  }
  if (isStaging) {
    publishPayload = { ...publishPayload, domain: gateway };
  }

  const registryKey = `apps/${account}/${gateway}/bos.config.json`;
  const publishedAt = new Date().toISOString();
  // version identity printed + returned for every deploy (atomic-deploys 12)
  const fingerprint = pointerFingerprint(publishPayload as never);
  const publishSlotPins = slotPins(publishPayload as never);
  const registryEntries: Record<string, string> = {
    [registryKey]: JSON.stringify(publishPayload),
  };
  const manifestKey = `apps/${account}/${gateway}/manifests/${publishedAt.replace(/[:.]/g, "-")}.json`;
  registryEntries[manifestKey] = JSON.stringify({
    account,
    gateway,
    network,
    publishedAt,
    registryUrl,
  });

  console.log();
  console.log("  Publishing to:");
  console.log(`    ${colors.cyan(registryUrl)}`);
  console.log(`    ${colors.dim("Fingerprint:")} ${fingerprint}`);
  for (const [slot, pin] of Object.entries(publishSlotPins)) {
    console.log(`    ${colors.dim(`${slot}:`)}`);
    console.log(`      ${pin}`);
  }
  console.log(
    `    ${colors.dim(`+ per-deploy manifest ${manifestKey.split("/").pop()} (audit trail)`)}`,
  );

  try {
    const alreadyPublished = await isConfigAlreadyPublished({
      account,
      gateway,
      publishConfig: publishPayload,
      registry: input.registry,
    });
    if (alreadyPublished) {
      console.log("  Already up to date — skipping transaction");
      return {
        status: "published",
        registryUrl,
        built,
        skipped,
        deployResults,
        publishConfig: publishPayload,
      };
    }

    console.log(`  Submitting transaction on ${network}...`);

    let result: { success: boolean; txHash?: string };
    if (useWallet) {
      const session = readSessionHandle(configDir);
      const credential = session?.credential;
      if (!credential || credential.accountId !== account) {
        return {
          status: "error",
          registryUrl,
          error: `--wallet requires a CLI session under ${account}. Run bos login first.`,
        };
      }
      const record = await ensureDelegateKey({
        configDir,
        account,
        contract: registryNamespace,
        network,
        siteUrl: credential.siteUrl,
      });
      result = await submitRegistryWriteDelegated({
        account,
        contract: registryNamespace,
        network,
        args: registryEntries,
        delegatePrivateKey: record.privateKey,
        relayEndpoint: `${credential.siteUrl}/api/auth/near/relay`,
        apiKey: credential.apiKey,
      });
    } else {
      if (!strategy) {
        return {
          status: "error",
          registryUrl,
          error: "non-wallet publish requires a resolved signing strategy",
        };
      }
      result = await submitRegistryWrite(
        {
          account,
          contract: registryNamespace,
          method: "__fastdata_kv",
          args: registryEntries,
          network,
          privateKey: input.privateKey,
        },
        strategy,
      );
    }

    if (result.txHash) {
      console.log(`  Transaction submitted: ${colors.dim(result.txHash)}`);
    }

    console.log("  Waiting for publish confirmation...");
    await waitForPublishedConfig({
      account,
      gateway,
      publishConfig: publishPayload,
      registry: input.registry,
    });

    return {
      status: "published",
      registryUrl,
      txHash: result.txHash,
      fingerprint,
      slotPins: publishSlotPins,
      built,
      skipped,
      deployResults,
      publishConfig: publishPayload,
    };
  } catch (error) {
    return {
      status: "error",
      registryUrl,
      error: formatNearError(error),
      built,
      skipped,
      deployResults,
    };
  }
}

function formatNearError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("does not have enough allowance")) {
    return (
      "The publish access key has insufficient allowance to cover this transaction.\n" +
      "  Regenerate your key with a higher allowance:\n" +
      "    bos key generate\n" +
      `  Original: ${message}`
    );
  }

  if (message.includes("exceeded gas") || message.includes("GasLimitExceeded")) {
    return `Transaction exceeded gas limit.\n  Original: ${message}`;
  }

  if (message.includes("timeout") || message.includes("Timeout")) {
    return `Transaction timed out. Check NEAR network status.\n  Original: ${message}`;
  }

  return message;
}
