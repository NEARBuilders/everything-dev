import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { Context, Effect, Layer } from "effect";
import { hasFolderFormUi } from "every-plugin/build/ui";
import { buildWorkspaceTargets, resolveWorkspaceTarget } from "../../build";
import { formatDuration } from "../../cli/timing";
import { generateCodeArtifacts } from "../../code-artifacts";
import { findConfigPath, isAppDescriptorPath, resolveUiRuntimeName } from "../../config";
import type { WorkspaceDeployResult } from "../../contract";
import { ensureCustodyBalance, submitRegistryWriteCustody } from "../../custody-signer";
import { ensureDelegateKey, submitRegistryWriteDelegated } from "../../delegate-signer";
import {
  type PreviousPin,
  pinsFromDeployState,
  pinsFromPublishedConfig,
  upsertDeployStatePins,
} from "../../deploy-diff";
import { fetchBosConfigFromFastKv } from "../../fastkv";
import { pointerFingerprint, slotPins } from "../../fingerprint";
import { applyDeployResults, type DeployResultEntry } from "../../integrity";
import { mergeAuthoredOverPublished } from "../../merge";
import { submitRegistryWrite } from "../../near-signer";
import { platformUrlDeployEntries, pluginUiUrlDeployEntries } from "../../platform-deploy";
import { openResolution } from "../../resolution/session";
import { verifyRollbackSnapshot } from "../../rollback";
import type { BosConfig, BosConfigInput, RuntimeConfig } from "../../types";
import { run } from "../../utils/run";
import { padRight } from "../../utils/string";
import { colors, icons } from "../../utils/theme";
import { PublishTrainError, type PublishTrainFailureResult, type PublishTrainOk } from "./errors";
import { formatNearError } from "./format";
import { type PublishPreflightPlan, preflightPublish } from "./preflight";
import { sourceLegDirs, uploadWorkspaceBundle } from "./upload-leg";

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
  /** Publish `bosConfig` verbatim — no authored/published merge, no ts-form
   * config-only guard. Rollbacks use this: the payload is the previous
   * snapshot, already assembled. */
  exactPayload?: boolean;
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
export async function runPublishTrain(input: DeployTrainInput): Promise<PublishTrainOk> {
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
      throw new PublishTrainError({
        kind: "reload",
        registryUrl,
        built,
        skipped,
        deployResults,
        error: "Failed to load the authored config for publish",
      });
    }
    rawConfig = opened.rawConfig;
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
          mergeAuthoredOverPublished((plan.publishedConfig ?? {}) as BosConfigInput, rawConfig)
        : rawConfig;

  const urlOrigin = plan.cdnOrigin ?? `https://${gateway}`;
  const deployTargets = (built ?? []).filter((key) => targets.includes(key));
  const platformEntries: DeployResultEntry[] = [];
  const fullUpload = input.fullUpload === true || process.env.BOS_FULL_UPLOAD === "1";
  // Previous per-workspace pins for the diff upload: the local pointer wins
  // (written after every confirmed publish), the published config is the
  // fallback. Neither → full upload.
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

  console.log();
  console.log(`  CDN deploy — uploading workspace dists to ${storageOrigin}...`);
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
  for (const key of deployTargets) {
    const ws = resolveWorkspaceTarget(key, bosConfig, runtimeConfig, configDir);
    if (!ws) continue;

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

    platformEntries.push(
      ...platformUrlDeployEntries({
        origin: urlOrigin,
        account,
        gateway,
        key,
        kind: ws.kind,
        integrity: outcome.entryIntegrity,
        ssrIntegrity: outcome.ssrEntryIntegrity,
        pin: outcome.pin,
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
      const uiName = resolveUiRuntimeName(rawUi, uiDistDir, key);
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
          pin: uiPin,
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
    const alreadyPublished = await isConfigAlreadyPublished({
      account,
      gateway,
      publishConfig: publishPayload,
      registry: input.registry,
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
    // ticket #422) — the submit phase consumes the plan's handles.
    let result: { success: boolean; txHash?: string };
    if (useCustody) {
      const custodyWallet = plan.custodyWallet;
      if (!custodyWallet) {
        throw new PublishTrainError({
          kind: "submit",
          registryUrl,
          error: "custody publish requires the preflight custody wallet",
        });
      }
      await ensureCustodyBalance(custodyWallet);
      console.log(
        `  Signing via ${colors.cyan(`OutLayer custody wallet ${custodyWallet.nearAccountId}`)}`,
      );
      result = await submitRegistryWriteCustody({
        contract: registryNamespace,
        args: registryEntries,
        custodyWallet,
        idempotencyKey: `bos-publish-${fingerprint}`,
      });
    } else if (useWallet) {
      const credential = plan.credential;
      if (!credential || credential.accountId !== account) {
        throw new PublishTrainError({
          kind: "submit",
          registryUrl,
          error: `--wallet requires a CLI session under ${account}. Run bos login first.`,
        });
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
        throw new PublishTrainError({
          kind: "submit",
          registryUrl,
          error: "non-wallet publish requires a resolved signing strategy",
        });
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
    };
  } catch (error) {
    if (error instanceof PublishTrainError) throw error;
    throw new PublishTrainError({
      kind: "submit",
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
    const ok = await runPublishTrain(input);
    return ok;
  } catch (error) {
    if (error instanceof PublishTrainError) return error.toResult();
    throw error;
  }
}

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
  static readonly Live = Layer.succeed(
    this,
    DeployTrainService.of({
      publish: (input: DeployTrainInput) =>
        Effect.tryPromise({
          try: () => runPublishTrain(input),
          catch: (error) =>
            error instanceof PublishTrainError
              ? error
              : new PublishTrainError({ kind: "submit", registryUrl: "", error: String(error) }),
        }),
    }),
  );
}
