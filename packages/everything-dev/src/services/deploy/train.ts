import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { Context, Effect, Layer, Option } from "effect";
import { hasFolderFormUi } from "every-plugin/build/ui";
import { findConfigPath, isAppDescriptorPath, resolveUiRuntimeName } from "../../config";
import type { WorkspaceDeployResult } from "../../contract";
import { openResolution } from "../../services/resolution/session";
import type { BosConfig, BosConfigInput, RuntimeConfig } from "../../types";
import { BosConfigSchema } from "../../types";
import { run } from "../../utils/run";
import { padRight } from "../../utils/string";
import { colors, icons } from "../../utils/theme";
import { ensureCustodyBalance, submitRegistryWriteCustody } from "../auth/custody-signer";
import { ensureDelegateKey, submitRegistryWriteDelegated } from "../auth/delegate-signer";
import { submitRegistryWrite } from "../auth/near-signer";
import { dispatchSubmit, SignerService, type SignerServiceShape } from "../auth/signer";
import { generateCodeArtifacts } from "../codegen/artifacts";
import { fetchBosConfigFromFastKv, fetchConfigHistory, fetchRegistryKey } from "../registry/fastkv";
import { pointerFingerprint, slotPins } from "../registry/fingerprint";
import { mergeAuthoredOverPublished, stripLocalDevelopmentTargets } from "../resolution/merge";
import {
  type BuildTargetsDeps,
  type BuildTargetsInput,
  type BuildTargetsResult,
  BuildTrainService,
  buildWorkspaceTargets,
  resolveWorkspaceTarget,
} from "../workspace/build-train";
import { BundleStorage, RegistryStore, type RegistryStoreShape } from "./deps";
import {
  type PreviousPin,
  pinsFromDeployState,
  pinsFromPublishedConfig,
  upsertDeployStatePins,
} from "./diff";
import { PublishTrainError, type PublishTrainFailureResult, type PublishTrainOk } from "./errors";
import { formatNearError } from "./format";
import { readFrameworkVersion } from "./image";
import { applyDeployResults, type DeployResultEntry } from "./integrity";
import { computeOwedWork } from "./owed";
import { platformUrlDeployEntries, pluginUiUrlDeployEntries } from "./platform";
import {
  composePlatformManifestPublishEntry,
  getPlatformManifestKey,
  getPlatformVersionSlotKey,
  type PlatformManifestPublishEntry,
  platformTruthViolations,
} from "./platform-manifest";
import { type PublishPreflightPlan, preflightPublish } from "./preflight";
import { type DeployTrainRender, DeployTrainRenderService } from "./render";
import { verifyRollbackSnapshot } from "./rollback";
import {
  realStorageLegDeps,
  type StorageLegDeps,
  sourceLegDirs,
  uploadWorkspaceBundle,
} from "./upload-leg";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort repo HEAD for the version manifest (`gitSha`): non-git
 * contexts (child bundles built outside a repo) omit the field silently —
 * it never fails the deploy. */
async function resolveGitSha(cwd: string): Promise<string | undefined> {
  try {
    const result = await run("git", ["rev-parse", "HEAD"], { cwd, capture: true });
    const sha = result?.stdout.trim();
    return result && result.exitCode === 0 && sha ? sha : undefined;
  } catch {
    return undefined;
  }
}

export async function waitForPublishedConfig(opts: {
  account: string;
  gateway: string;
  publishConfig: BosConfigInput;
  registry?: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchConfig?: typeof fetchBosConfigFromFastKv;
  /** The submit's tx hash (#430): once the registry history shows this tx,
   * the write has landed on-chain — one authoritative read-back decides
   * instead of repeated deep-equality polling. */
  txHash?: string;
  fetchHistory?: typeof fetchConfigHistory;
}): Promise<void> {
  const fetchConfig = opts.fetchConfig ?? fetchBosConfigFromFastKv;
  const envTimeoutMs = Number(process.env.BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS);
  const envIntervalMs = Number(process.env.BOS_PUBLISH_CONFIRMATION_INTERVAL_MS);
  const timeoutMs =
    opts.timeoutMs ?? (Number.isFinite(envTimeoutMs) ? envTimeoutMs : undefined) ?? 120_000;
  const intervalMs =
    opts.intervalMs ?? (Number.isFinite(envIntervalMs) ? envIntervalMs : undefined) ?? 3_000;
  const startedAt = Date.now();
  let lastError: unknown;

  // The tx probe is the cheap poll (#430): while it is informative (returns
  // entries, tx not yet visible), the config equality read-back waits. After
  // a bounded run of informative-but-absent probes — or any probe failure —
  // the wait falls back permanently to plain equality polling, so a registry
  // whose history never carries the tx still confirms.
  let txProbeSkips = 0;
  const TX_PROBE_SKIP_LIMIT = 2;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      let trackByTx = opts.txHash !== undefined && opts.fetchHistory !== undefined;
      if (trackByTx && txProbeSkips >= TX_PROBE_SKIP_LIMIT) {
        trackByTx = false;
      }

      if (trackByTx) {
        try {
          const history = await opts.fetchHistory!({
            accountId: opts.account,
            gatewayId: opts.gateway,
            registry: opts.registry,
            limit: 5,
          });
          const txLanded = history.some((entry) => entry.txHash === opts.txHash);
          if (txLanded) {
            // The write landed on-chain — the read-back is the authoritative
            // content check (ADR 0001). A mismatch keeps polling:
            // replication may lag the tx.
            txProbeSkips = 0;
          } else {
            txProbeSkips += 1;
            await sleep(intervalMs);
            continue;
          }
        } catch (historyError) {
          // A history probe failure must not starve the wait — fall back to
          // the plain equality poll.
          lastError = historyError;
        }
      }

      const verifiedConfig = await fetchConfig<BosConfigInput>(
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
  fetchConfig?: typeof fetchBosConfigFromFastKv;
}): Promise<boolean> {
  const fetchConfig = opts.fetchConfig ?? fetchBosConfigFromFastKv;
  try {
    const current = await fetchConfig<BosConfigInput>(
      `bos://${opts.account}/${opts.gateway}`,
      opts.registry,
    );
    return JSON.stringify(current) === JSON.stringify(opts.publishConfig);
  } catch {
    return false;
  }
}

/** Per-workspace upload facts the renderer needs (#431) — the leg reports,
 * the renderer shows. */
export interface UploadUnitDetail {
  base: string;
  uploaded: number;
  skipped: number;
  durationMs: number;
  notes: string[];
}

export interface TrainDeps {
  storage: StorageLegDeps;
  registry: RegistryStoreShape;
  signer: SignerServiceShape;
  /** presentation seam (#431) — sections render; the train never prints */
  render?: DeployTrainRender;
  buildTrain: {
    buildTargets: (
      input: BuildTargetsInput,
      deps?: BuildTargetsDeps,
    ) => Promise<BuildTargetsResult>;
  };
}

export interface DeployTrainInput {
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
  /** Skip the diff upload and re-upload every dist file (escape hatch). */
  fullUpload?: boolean;
  /** Force every prerequisite rebuild even when the content-hash oracle judges
   * them fresh (the pre-#430 behavior; escape hatch for the oracle). */
  forceBuild?: boolean;
  /** Publish `bosConfig` verbatim — no authored/published merge, no ts-form
   * config-only guard. Rollbacks use this: the payload is the previous
   * snapshot, already assembled. */
  exactPayload?: boolean;
  /** Rollback-only pointer restore (#573): a smoke-failed release rolls the
   * config AND the platform pointer back in the same atomic write. Ignored
   * unless `exactPayload` — normal deploys cannot smuggle manifest writes
   * past the release gate. */
  restorePlatformPointer?: { key: string; value: string };
}

/**
 * The deploy-train publish core (ADR 0020, as amended): preflight
 * (storage/CDN creds + signing) fails fast before the build, then build →
 * upload → version-manifest pin → config write-back → FastKV publish +
 * read-back. Scoped to one plugin via `packages`, a single-plugin redeploy
 * ships real bytes to the storage origin — same as the full train, nothing
 * image-native left.
 *
 * Terminal failures throw `PublishTrainError` (the typed channel, ticket
 * #422); callers behind the service map it to wire shapes mechanically.
 */
export async function runPublishTrain(
  input: DeployTrainInput,
  deps: TrainDeps,
): Promise<PublishTrainOk> {
  const preflight = await preflightPublish(input);
  if (preflight.kind === "error") {
    throw new PublishTrainError({
      kind: "preflight",
      registryUrl: preflight.registryUrl,
      error: preflight.error,
    });
  }
  if (preflight.kind === "dry-run") {
    return { status: "dry-run", registryUrl: preflight.registryUrl };
  }
  const plan: PublishPreflightPlan = preflight.plan;
  const {
    isStaging,
    account,
    gateway,
    network,
    registryUrl,
    registryNamespace,
    targets,
    useWallet,
    useCustody,
    strategy,
  } = plan;
  const storageOrigin = plan.storageOrigin;
  const storageApiKey = plan.storageApiKey;

  const { configDir } = input;
  const render = deps.render;
  let bosConfig = input.bosConfig;
  const runtimeConfig = input.runtimeConfig;
  let built: string[] | undefined;
  let skipped: string[] | undefined;
  let deployResults: WorkspaceDeployResult[] | undefined;
  const urlOrigin = plan.cdnOrigin ?? `https://${gateway}`;
  const platformEntries: DeployResultEntry[] = [];
  const fullUpload = input.fullUpload === true || process.env.BOS_FULL_UPLOAD === "1";
  const sourcePublish = bosConfig.publish?.sourcePublish === true;
  const gitSha = await resolveGitSha(configDir);
  const memoryBackendAbort = () =>
    new PublishTrainError({
      kind: "memory-backend",
      registryUrl,
      built,
      skipped,
      deployResults,
      error:
        "The receiving instance is serving bundle storage from memory (BOS_STORAGE_* R2 credentials are not configured there) — uploaded bytes would be lost on restart. Aborting before publish.",
    });

  // Previous per-workspace pins for the diff upload: the local pointer wins
  // (written after every confirmed publish), the published config is the
  // fallback. Neither → full upload. Hoisted above the build so pipelined
  // uploads can read it the moment a build completes.
  const prevPins: Record<string, PreviousPin> = fullUpload
    ? {}
    : {
        ...pinsFromPublishedConfig(
          (plan.publishedConfig ?? {}) as BosConfigInput,
          account,
          gateway,
        ),
        ...pinsFromDeployState(configDir, account, gateway),
      };

  const authoredPath = findConfigPath(configDir);
  const tsForm = authoredPath !== null && isAppDescriptorPath(authoredPath);
  // Resolved before the build phase: pipelined uploads (#430) start the moment
  // a workspace build completes and the folder-form plugin-ui leg reads the
  // authored config — the binding must be live by then, never first
  // initialized after the train. The post-build refresh reassigns
  // publishRawConfig for the publish payload.
  const openedRaw = await openResolution({ cwd: configDir });
  if (!openedRaw?.rawConfig) {
    throw new PublishTrainError({
      kind: "reload",
      registryUrl,
      built,
      skipped,
      deployResults,
      error: "Failed to load the authored config for publish",
    });
  }
  const authoredRawConfig = openedRaw.rawConfig;
  let publishRawConfig: BosConfigInput = authoredRawConfig;

  render?.cdnBanner?.(storageOrigin);

  // One workspace = one upload unit: the workspace bundle, then (for
  // folder-form plugin workspaces) its <plugin>/ui/dist as its own bundle
  // key. Workspace paths resolve from the authored config — identical before
  // and after the post-build config refresh — so pipelined uploads (#430) can
  // start the moment a build completes.
  const uploadOneWorkspace = async (
    key: string,
    rawConfig: BosConfigInput,
  ): Promise<{
    entries: DeployResultEntry[];
    detail: UploadUnitDetail;
    shared: Record<string, Record<string, string>>;
  }> => {
    const startedAt = Date.now();
    const ws = resolveWorkspaceTarget(key, bosConfig, runtimeConfig, configDir);
    if (!ws)
      return {
        entries: [],
        detail: { base: "", uploaded: 0, skipped: 0, durationMs: 0, notes: [] },
        shared: {},
      };

    const outcome = await uploadWorkspaceBundle({
      account,
      gateway,
      workspaceKey: key,
      distDir: join(ws.path, "dist"),
      storageOrigin,
      storageApiKey,
      urlOrigin,
      previousPin: prevPins[key],
      ...(sourcePublish ? { source: sourceLegDirs(ws.path) } : {}),
      ...(gitSha ? { gitSha } : {}),
      deps: deps.storage,
    });
    if (outcome.kind === "error") {
      throw new PublishTrainError({
        kind: "upload",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: outcome.message,
      });
    }
    if (outcome.kind === "memory") throw memoryBackendAbort();
    if (outcome.kind === "missing-manifest") {
      throw new PublishTrainError({
        kind: "missing-manifest",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: `bundle upload for ${key}: version manifest missing — the dist predates hashed entry names (rebuild required; atomic-deploys hard break)`,
      });
    }

    if (sourcePublish && outcome.storage === "memory") throw memoryBackendAbort();

    const entries = platformUrlDeployEntries({
      origin: urlOrigin,
      account,
      gateway,
      key,
      kind: ws.kind,
      integrity: outcome.entryIntegrity,
      ssrIntegrity: outcome.ssrEntryIntegrity,
      pin: outcome.pin,
    });

    // Folder-form plugin ui: the workspace build also produces <plugin>/ui/dist
    // (web remoteEntry + ssr container) — upload it as its own bundle key and
    // pin <slot>.<key>.ui.* so the host can compose the ui surface in production.
    let uiOutcomeShared: Record<string, string> | undefined;
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
      let uiPin: (typeof outcome)["pin"] | undefined;
      if (existsSync(uiDistDir)) {
        const uiOutcome = await uploadWorkspaceBundle({
          account,
          gateway,
          workspaceKey: `${key}-ui`,
          distDir: uiDistDir,
          storageOrigin,
          storageApiKey,
          urlOrigin,
          previousPin: prevPins[`${key}-ui`],
          deps: deps.storage,
        });
        if (uiOutcome.kind === "error") {
          throw new PublishTrainError({
            kind: "upload",
            registryUrl,
            built,
            skipped,
            deployResults,
            error: uiOutcome.message,
          });
        }
        if (uiOutcome.kind === "memory") throw memoryBackendAbort();
        if (uiOutcome.kind === "missing-manifest") {
          throw new PublishTrainError({
            kind: "missing-manifest",
            registryUrl,
            built,
            skipped,
            deployResults,
            error: `bundle upload for ${key}-ui: version manifest missing — the dist predates hashed entry names (rebuild required; atomic-deploys hard break)`,
          });
        }
        uiIntegrity = uiOutcome.entryIntegrity;
        uiSsrIntegrity = uiOutcome.ssrEntryIntegrity;
        uiPin = uiOutcome.pin;
        uiOutcomeShared = uiOutcome.shared;
      } else {
        console.log(
          `    ${colors.green(icons.ok)} ${padRight(`${key}-ui`, 28)} → ${urlOrigin}/bundles/${account}/${gateway}/${key}-ui/`,
        );
      }

      entries.push(
        ...pluginUiUrlDeployEntries({
          origin: urlOrigin,
          account,
          gateway,
          key,
          kind: ws.kind,
          integrity: uiIntegrity,
          ssrIntegrity: uiSsrIntegrity,
          name: uiName,
          pin: uiPin,
        }),
      );
    }

    return {
      entries,
      detail: {
        base: outcome.detail.base,
        uploaded: outcome.uploaded,
        skipped: outcome.skipped,
        durationMs: Date.now() - startedAt,
        notes: outcome.detail.notes,
      },
      shared: {
        ...(outcome.shared ? { [key]: outcome.shared } : {}),
        ...(uiOutcomeShared ? { [`${key}-ui`]: uiOutcomeShared } : {}),
      },
    };
  };

  // Uploads are independent bundle keys (#430): bounded concurrency, and —
  // when building — each workspace's upload pipelines as its build completes
  // instead of waiting for the whole train. The merged config assembles in
  // target order (byte-identical to the serial train); the first failure in
  // that order is the one thrown.
  const uploadConcurrency = Math.max(1, Number(process.env.BOS_UPLOAD_CONCURRENCY) || 4);
  interface UploadUnitResult {
    entries: DeployResultEntry[];
    detail: UploadUnitDetail;
    /** Shared-singleton versions per uploaded bundle key (#546) — the truth
     * gate cross-checks these against the platform release manifest. */
    shared: Record<string, Record<string, string>>;
  }
  const uploaded = new Map<string, Promise<UploadUnitResult>>();
  // Rejections stay in the map until the drain's allSettled — deleting would
  // both swallow the failure (the drain substitutes an empty result) and let
  // the fallback loop silently re-attempt the upload. The immediate no-op
  // catch keeps the pipelined rejection handled while the build continues.
  const trackUpload = (key: string, pending: Promise<UploadUnitResult>) => {
    uploaded.set(key, pending);
    pending.catch(() => {});
  };
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  const acquireUploadSlot = () => {
    if (inFlight < uploadConcurrency) {
      inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiters.push(resolve));
  };
  const releaseUploadSlot = () => {
    inFlight--;
    waiters.shift()?.();
  };
  const startUpload = (key: string) => {
    if (uploaded.has(key)) return;
    trackUpload(
      key,
      (async () => {
        await acquireUploadSlot();
        try {
          return await uploadOneWorkspace(key, authoredRawConfig);
        } finally {
          releaseUploadSlot();
        }
      })(),
    );
  };

  if (input.build) {
    await generateCodeArtifacts(configDir, bosConfig, {
      env: "production",
      runtimeConfig: runtimeConfig ?? undefined,
    });

    const result = await deps.buildTrain.buildTargets(
      {
        configDir,
        bosConfig,
        runtimeConfig,
        targets,
        deploy: true,
        verbose: input.verbose,
        ...(input.forceBuild ? { forceBuild: true } : {}),
      },
      {
        onWorkspaceBuilt: (key) => {
          if (targets.includes(key)) startUpload(key);
        },
      },
    );
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
        throw new PublishTrainError({
          kind: "build",
          registryUrl,
          built,
          skipped,
          deployResults,
          error: `${failures.length} of ${total} workspaces failed to deploy`,
        });
      }
    }

    const refreshed = await openResolution({ cwd: configDir });
    if (!refreshed?.config) {
      throw new PublishTrainError({
        kind: "reload",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: "Failed to reload the config after build",
      });
    }

    bosConfig = refreshed.config;
    if (refreshed.rawConfig) publishRawConfig = refreshed.rawConfig;
  }

  if (
    tsForm &&
    !input.build &&
    input.exactPayload !== true &&
    plan.publishedConfigState === "unreachable"
  ) {
    // A config-only TS-form publish derives its pipeline state from the live
    // published config — publishing without it would wipe bundle URLs.
    throw new PublishTrainError({
      kind: "config-state",
      registryUrl,
      built,
      skipped,
      deployResults,
      error:
        "Cannot read the currently published config from the registry — a config-only publish would overwrite live bundle URLs. Retry when the registry is reachable, or run a full deploy.",
    });
  }
  let publishPayload: BosConfigInput =
    input.exactPayload === true
      ? // The rollback payload is a previous snapshot: Zod-parsed form, already
        // assembled — the hand-written input shape and the parsed shape agree
        // at runtime; the declared types don't (pre-existing publish.ts:779).
        (input.bosConfig as unknown as BosConfigInput)
      : tsForm && !input.build
        ? // Config-only publish on a TS-form project: the authored config owns
          // composition (hand-edits win) while live pipeline state (bundle
          // URLs, integrity) carries over from the published config.
          mergeAuthoredOverPublished(
            (plan.publishedConfig ?? {}) as BosConfigInput,
            publishRawConfig,
          )
        : publishRawConfig;

  // Everything the pipeline has not already started uploads now — same
  // bounded pool. With build:false there is nothing to upload (config-only).
  for (const key of built ?? []) {
    if (targets.includes(key)) startUpload(key);
  }

  const deployTargets = (built ?? []).filter((key) => targets.includes(key));
  const settled = await Promise.allSettled(
    deployTargets.map(
      (key) =>
        uploaded.get(key) ??
        Promise.resolve({
          entries: [],
          detail: { base: "", uploaded: 0, skipped: 0, durationMs: 0, notes: [] },
          shared: {},
        }),
    ),
  );
  // Shared-singleton versions per uploaded bundle key (#546) — the truth gate
  // consumes this before the platform manifest rides the atomic publish.
  const sharedByWorkspace = new Map<string, Record<string, string>>();

  const uploadFailures = settled
    .map((result, index) =>
      result.status === "rejected"
        ? { key: deployTargets[index], error: result.reason as unknown }
        : null,
    )
    .filter((entry): entry is { key: string; error: unknown } => entry !== null);

  for (let index = 0; index < deployTargets.length; index++) {
    const result = settled[index];
    const key = deployTargets[index];
    if (result.status === "fulfilled") {
      platformEntries.push(...result.value.entries);
      for (const [bundleKey, shared] of Object.entries(result.value.shared)) {
        sharedByWorkspace.set(bundleKey, shared);
      }
      render?.uploadOutcome?.({
        key,
        ok: true,
        ...(input.verbose ? { detailNotes: result.value.detail.notes } : {}),
        ...result.value.detail,
      });
    } else {
      render?.uploadOutcome?.({ key, ok: false });
    }
  }

  if (uploadFailures.length > 0) {
    const thrown = uploadFailures[0].error;
    if (thrown instanceof PublishTrainError) throw thrown;
    throw new PublishTrainError({
      kind: "upload",
      registryUrl,
      built,
      skipped,
      deployResults,
      error: thrown instanceof Error ? thrown.message : String(thrown),
    });
  }

  if (platformEntries.length > 0) {
    const merged = applyDeployResults(publishRawConfig as Record<string, unknown>, platformEntries);
    if (!tsForm) {
      // Legacy JSON-form children keep their local write-back; TS-form keeps
      // pipeline state in FastKV only — a write-back would shadow the
      // authored bos.app.ts descriptor.
      try {
        writeFileSync(join(configDir, "bos.config.json"), `${JSON.stringify(merged, null, 2)}\n`);
      } catch (error) {
        throw new PublishTrainError({
          kind: "config-write",
          registryUrl,
          built,
          skipped,
          deployResults,
          error: `Failed to write bundle URLs to bos.config.json: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    publishPayload = merged as BosConfigInput;
  }
  if (isStaging) {
    publishPayload = { ...publishPayload, domain: gateway };
  }
  // Publish canonicalization (#584): the published payload never carries
  // `local:` development targets — workspace-relative refs are meaningless
  // across an extends boundary, and children inheriting one cannot spawn it.
  // The authored surface keeps them for the parent's own dev; children fall
  // back to the slot's published URL. Rollback payloads are already
  // canonical — republished verbatim.
  if (input.exactPayload !== true) {
    publishPayload = stripLocalDevelopmentTargets(publishPayload);
  }

  // Every runtime boot validates the fetched payload with BosConfigSchema
  // (resolvePublishedConfig) — this catches canonicalization/schema drift at
  // preflight instead of failing the post-publish smoke and rolling back.
  const schemaCheck = BosConfigSchema.safeParse(publishPayload);
  if (!schemaCheck.success) {
    const detail = schemaCheck.error.issues
      .slice(0, 5)
      .map((issue) => `    ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new PublishTrainError({
      kind: "preflight",
      registryUrl,
      built,
      skipped,
      deployResults,
      error: `Canonicalized publish payload fails BosConfigSchema — booting it would fail everywhere:\n${detail}`,
    });
  }

  const pinVerification = await verifyRollbackSnapshot(publishPayload);
  if (pinVerification.verifiable && !pinVerification.ok) {
    const failures = pinVerification.slots
      .filter((check) => !check.ok)
      .map((check) => `    ${check.slot}: ${check.reason}`)
      .join("\n");
    console.error(
      `  ${colors.error(icons.err)} Publish blocked — a pinned slot's bytes do not serve at its production URL:\n${failures}`,
    );
    throw new PublishTrainError({
      kind: "pin-verification",
      registryUrl,
      built,
      skipped,
      deployResults,
      error: `Publish blocked — pinned slot bytes missing or SRI mismatched:\n${failures}`,
    });
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
  // ADR 0034 + #573: the platform release manifest rides the same atomic
  // write as the config. The truth gate (shared-singleton cross-check) runs
  // on every production build deploy — but only the **release leg** writes
  // keys: the immutable `platform-versions/<version>` slot plus the
  // `platform.json` pointer flip. Non-release deploys write no manifest
  // keys at all. The preflight npm gate guarantees npm is published before
  // the build (npmOwed is impossible in-train until #575 moves the npm leg
  // in), so the release classifier is the pointer alone — and its read MUST
  // succeed: an unknown state must never silently classify a release as
  // non-release (the skip path is deleted, #573). Satellites keep
  // independent npm releases and are not gating for the platform; the
  // manifest records the composition as smoke-tested at the release SHA.
  // A release that cannot complete cleanly burns its counter — never reuse
  // a version.
  let platformManifest: PlatformManifestPublishEntry | null = null;
  if (!isStaging && input.build) {
    let pointer: { frameworkVersion?: string } | null;
    try {
      pointer = await fetchRegistryKey<{ frameworkVersion?: string }>(
        account,
        gateway,
        "platform.json",
      );
    } catch (error) {
      throw new PublishTrainError({
        kind: "platform-manifest",
        registryUrl,
        built,
        skipped,
        deployResults,
        error:
          `could not read the published platform release — the release classifier and ` +
          `the compat floor must never be guessed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    const owed = computeOwedWork({
      pointer: pointer
        ? { state: "present", frameworkVersion: pointer.frameworkVersion }
        : { state: "absent" },
      localFrameworkVersion: readFrameworkVersion(configDir),
    });
    const releaseLeg = owed.release;
    console.log(
      releaseLeg
        ? colors.cyan(
            `  Release leg: the platform pointer (${owed.detail.pointerFrameworkVersion ?? "unset"}) trails the repo (${owed.detail.localFrameworkVersion}) — the release manifest moves`,
          )
        : colors.dim("  No release work owed — the platform manifest stays put"),
    );

    const composed = composePlatformManifestPublishEntry({
      configDir,
      account,
      gateway,
      previousFrameworkVersion: pointer?.frameworkVersion,
      gitSha,
    });
    // The truth gate (#546, extended by #573): runs on EVERY production
    // deploy against the composed release manifest — a workspace whose
    // installed shared versions drifted from the catalog (stale install,
    // misaligned bump) would publish bundles that lie about the compat
    // window. Refuses loudly until the next rc realigns them.
    if (composed) {
      const violations = platformTruthViolations(composed.manifest, sharedByWorkspace);
      if (violations.length > 0) {
        throw new PublishTrainError({
          kind: "platform-truth",
          registryUrl,
          built,
          skipped,
          deployResults,
          error:
            `platform manifest does not match the uploaded bundles:\n` +
            violations.map((line) => `    ${line}`).join("\n"),
        });
      }
      if (releaseLeg) {
        const frameworkVersion = composed.manifest.frameworkVersion;
        const slotRelKey = `platform-versions/${frameworkVersion}.json`;
        const slotKey = getPlatformVersionSlotKey(account, gateway, frameworkVersion);
        let existingSlot: unknown;
        try {
          existingSlot = await fetchRegistryKey<unknown>(account, gateway, slotRelKey);
        } catch (error) {
          throw new PublishTrainError({
            kind: "platform-manifest",
            registryUrl,
            built,
            skipped,
            deployResults,
            error: `the release leg could not verify the version slot's immutability (${slotKey}): ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        if (existingSlot !== null) {
          const existingValue =
            typeof existingSlot === "string" ? existingSlot : JSON.stringify(existingSlot);
          if (existingValue !== composed.value) {
            throw new PublishTrainError({
              kind: "platform-manifest",
              registryUrl,
              built,
              skipped,
              deployResults,
              error: `version ${frameworkVersion} is burned — the immutable slot ${slotKey} already holds different bytes. Bump the version and cut a fresh release; never reuse a burned one.`,
            });
          }
          console.log(
            colors.dim(
              `  version slot ${frameworkVersion} already holds identical bytes — idempotent republish`,
            ),
          );
        }
        platformManifest = { ...composed, key: slotKey };
      }
    }
  }
  registryEntries[manifestKey] = JSON.stringify({
    account,
    gateway,
    network,
    publishedAt,
    registryUrl,
    ...(platformManifest
      ? {
          platformManifest: {
            file: platformManifest.key,
            integrity: platformManifest.integrity,
            version: platformManifest.manifest.frameworkVersion,
            pointer: getPlatformManifestKey(account, gateway),
          },
        }
      : {}),
  });
  if (platformManifest) {
    // One atomic write (#573): the immutable version slot + the pointer flip.
    registryEntries[platformManifest.key] = platformManifest.value;
    registryEntries[getPlatformManifestKey(account, gateway)] = platformManifest.value;
  }
  if (input.exactPayload && input.restorePlatformPointer) {
    registryEntries[input.restorePlatformPointer.key] = input.restorePlatformPointer.value;
  }

  render?.publish?.({
    registryUrl,
    fingerprint,
    slotPins: Object.entries(publishSlotPins),
    auditManifestFile: manifestKey.split("/").pop() ?? manifestKey,
  });

  // Record the live pins for the next deploy's diff upload — only after the
  // config is confirmed published, so the pointer never claims undeployed state.
  const persistDeployState = () => {
    try {
      const pins = pinsFromPublishedConfig(publishPayload as BosConfigInput, account, gateway);
      if (Object.keys(pins).length > 0) {
        upsertDeployStatePins(configDir, account, gateway, pins);
      }
    } catch (error) {
      console.log(
        colors.dim(
          `  Note: could not update .bos/deploy-state.json — ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  };

  try {
    // NOT deduped with the preflight's published-config read (#430): that
    // fetch returns the raw stored JSON, while the idempotency comparison is
    // normalization-sensitive (the registry reader Zod-parses — defaults and
    // key order differ) — comparing across the two readers misdetects drift
    // and would republish every run. The equality fetch stays.
    const alreadyPublished = await isConfigAlreadyPublished({
      account,
      gateway,
      publishConfig: publishPayload,
      registry: input.registry,
      fetchConfig: deps.registry.fetchConfig,
    });
    if (alreadyPublished) {
      console.log("  Already up to date — skipping transaction");
      persistDeployState();
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

    // Auth handles were validated once in preflight (guards once per run,
    // ticket #422) — the dispatch consumes the plan's handles.
    const result = await (async (): Promise<{ success: boolean; txHash?: string }> => {
      if (useCustody) {
        if (!plan.custodyWallet) {
          throw new PublishTrainError({
            kind: "submit",
            registryUrl,
            error: "custody publish requires the preflight custody wallet",
          });
        }
        return deps.signer.submit({
          mode: "custody",
          account,
          contract: registryNamespace,
          args: registryEntries,
          custodyWallet: plan.custodyWallet,
          idempotencyKey: `bos-publish-${fingerprint}`,
        });
      }
      if (useWallet) {
        const credential = plan.credential;
        if (!credential || credential.accountId !== account) {
          throw new PublishTrainError({
            kind: "submit",
            registryUrl,
            error: `--wallet requires a CLI session under ${account}. Run bos login first.`,
          });
        }
        return deps.signer.submit({
          mode: "wallet",
          account,
          contract: registryNamespace,
          network,
          args: registryEntries,
          credential,
          configDir,
        });
      }
      if (!strategy) {
        throw new PublishTrainError({
          kind: "submit",
          registryUrl,
          error: "non-wallet publish requires a resolved signing strategy",
        });
      }
      return deps.signer.submit({
        mode: "key",
        account,
        contract: registryNamespace,
        network,
        args: registryEntries,
        privateKey: input.privateKey,
        strategy,
      });
    })();

    if (result.txHash) {
      console.log(`  Transaction submitted: ${colors.dim(result.txHash)}`);
    }

    console.log("  Waiting for publish confirmation...");
    try {
      await waitForPublishedConfig({
        account,
        gateway,
        publishConfig: publishPayload,
        registry: input.registry,
        fetchConfig: deps.registry.fetchConfig,
        ...(result.txHash
          ? { txHash: result.txHash, fetchHistory: deps.registry.fetchHistory }
          : {}),
      });
    } catch (error) {
      throw new PublishTrainError({
        kind: "confirm",
        registryUrl,
        error: formatNearError(error),
        built,
        skipped,
        deployResults,
      });
    }
    persistDeployState();

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
      releaseLeg: platformManifest !== null,
    };
  } catch (error) {
    if (error instanceof PublishTrainError) throw error;
    throw new PublishTrainError({
      kind: "sign",
      registryUrl,
      error: formatNearError(error),
      built,
      skipped,
      deployResults,
    });
  }
}

/** Procedural entry point: the train behind a plain promise — legacy callers
 * and tests see the string-error result shape, the Effect service maps the
 * typed channel. */
export async function publishToFastKv(input: DeployTrainInput): Promise<PublishToFastKvResult> {
  try {
    const ok = await runPublishTrain(input, realTrainDeps);
    return ok;
  } catch (error) {
    if (error instanceof PublishTrainError) return error.toResult();
    throw error;
  }
}

const defaultBuildTrain = {
  buildTargets: (input: BuildTargetsInput, deps?: BuildTargetsDeps) =>
    buildWorkspaceTargets(input, deps),
};

export const realTrainDeps: TrainDeps = {
  buildTrain: defaultBuildTrain,
  storage: realStorageLegDeps,
  registry: { fetchConfig: fetchBosConfigFromFastKv, fetchHistory: fetchConfigHistory },
  signer: {
    submitRegistryWrite,
    submitRegistryWriteDelegated,
    submitRegistryWriteCustody,
    ensureDelegateKey,
    ensureCustodyBalance,
    submit: dispatchSubmit,
  },
};

export type PublishToFastKvResult = PublishTrainOk | PublishTrainFailureResult;

/**
 * The train as a Context.Service (ticket #422): `publish` fails with the
 * typed `PublishTrainError`; handlers yield the service and map failures
 * mechanically.
 */
export class DeployTrainService extends Context.Service<
  DeployTrainService,
  {
    publish: (input: DeployTrainInput) => Effect.Effect<PublishTrainOk, PublishTrainError>;
  }
>()("everything-dev/deploy/train") {
  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const storage = yield* BundleStorage;
      const registry = yield* RegistryStore;
      const signer = yield* SignerService;
      const buildTrainOption = yield* Effect.serviceOption(BuildTrainService);
      const renderOption = yield* Effect.serviceOption(DeployTrainRenderService);
      return DeployTrainService.of({
        publish: (input: DeployTrainInput) =>
          Effect.tryPromise({
            try: () =>
              runPublishTrain(input, {
                storage,
                registry,
                signer,
                buildTrain: Option.getOrUndefined(buildTrainOption) ?? defaultBuildTrain,
                render: Option.getOrUndefined(renderOption),
              }),
            catch: (error) =>
              error instanceof PublishTrainError
                ? error
                : new PublishTrainError({ kind: "submit", registryUrl: "", error: String(error) }),
          }),
      });
    }),
  );
}
