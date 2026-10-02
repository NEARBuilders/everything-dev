import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import * as p from "@clack/prompts";
import { Context, Effect, Layer } from "effect";
import { buildScoped, buildScopedContext } from "every-plugin";
import { type KeyPair, parseKey } from "near-kit";
import { buildRuntimeConfig, probePortBindable } from "./app";
import { openInBrowser, startDeviceLogin } from "./auth-login";
import {
  deleteSessionHandle,
  nearCredentialsPath,
  readSessionHandle,
  removePublishedKeyFile,
  type SessionCredential,
  writeSessionHandle,
} from "./auth-session";
import {
  buildWorkspaceTargets,
  fileExists,
  getPluginRef,
  readJsonFile,
  selectWorkspaceTargets,
} from "./build";
import { buildCiInfraPlan, type CiInfraPlan } from "./cli/infra";
import {
  buildInitPatterns,
  buildPluginRouteExclusions,
  convertChildConfigToAppForm,
  copyFilteredFiles,
  detectGitRemoteUrl,
  fetchParentConfig,
  generateDatabaseMigrations,
  personalizeAgentsMd,
  personalizeConfig,
  removeInitLockfile,
  resolveSourceDir,
  runBunInstall,
  runTypesGen,
  scaffoldMinimalProject,
  stripOrphanedWorkspacesFromLockfile,
  writeInitSnapshot,
} from "./cli/init";
import { pruneUnusedUiFiles } from "./cli/prune";
import { getStatus } from "./cli/status";
import { syncTemplate } from "./cli/sync";
import { upgradeTemplate } from "./cli/upgrade";
import { generateCodeArtifacts } from "./code-artifacts";
import {
  drainConfigWarnings,
  findConfigPath,
  getProjectRoot,
  getResolvedConfigPath,
  loadGeneratedResolvedConfig,
  loadLocalConfig,
  loadResolvedConfig,
  readGeneratedConfigFile,
  resolveConfigComposableEntries,
  resumeWarnings,
  suppressWarnings,
  writeGeneratedConfigFile,
} from "./config";
import type { LoginResult } from "./contract";
import {
  type BosConfigResult,
  bosContract,
  type OverrideSection,
  type PhaseTiming,
  type PluginListResult,
} from "./contract";
import {
  DatabaseBindings,
  type DatabaseBindingsService,
  DrizzleKit,
  type DrizzleKitService,
  makeDatabaseBindings,
  makeDrizzleKitLive,
} from "./db";
import { readDevLatestLog, resolveDevLatestFile } from "./dev-logs";
import {
  bootstrapLayers,
  type DevSessionData,
  devBootstrap,
  resolveProxyUrl,
  type StartSummary,
  startBootstrap,
} from "./dev-program";
import { makeProjectEnv, ProjectEnv, ProjectEnvLive } from "./env/project-env";
import {
  fetchBosConfigFromFastKv,
  fetchRemotePluginManifest,
  getRegistryNamespaceForAccount,
  type PluginManifest,
  parseBosUrl,
} from "./fastkv";
import { materializeViaLayer } from "./infra/materializer";
import { ownerOfPort } from "./infra/port-ownership";
import { type BosEnv, mergeBosConfigWithExtends, resolveExtendsRef } from "./merge";
import { checkFederationCompat } from "./mf";
import {
  addFunctionCallAccessKey,
  deleteAccessKeys,
  ensureNearCli,
  generateNearKeyPair,
  listPublishKeys,
} from "./near-cli";
import { getNetworkIdForAccount } from "./network";
import { applyPluginPublishUrl } from "./platform-deploy";
import { killProcessGroupEscalating, reapGroup } from "./process-kill";
import { isPidAlive, pruneDeadEffect, readRegistry, unregisterPid } from "./process-registry";
import { timePhase } from "./progress";
import { publishToFastKv } from "./publish";
import { applyRegistrySections } from "./registry-use";
import { createPlugin, z } from "./sdk";
import { syncResolvedSharedDeps } from "./shared-deps";
import type { BosConfig, BosConfigInput, ExtendsConfig, RuntimeConfig } from "./types";
import { BosConfigSchema } from "./types";
import { run } from "./utils/run";
import { saveBosConfig } from "./utils/save-config";
import { colors } from "./utils/theme";

export type { DevSessionData, StartSummary } from "./dev-program";
export { type ProgressEvent, pluginEvents } from "./progress";

let pendingSession: DevSessionData | null = null;
let pendingStartSummary: StartSummary | null = null;

export function consumeDevSession(): (DevSessionData & { summary?: StartSummary }) | null {
  const data = pendingSession;
  const summary = pendingStartSummary;
  pendingSession = null;
  pendingStartSummary = null;
  if (!data) return null;
  return summary ? { ...data, summary } : data;
}

const PUBLISH_FUNCTION_NAMES = ["__fastdata_kv"];

type BosDeps = {
  bosConfig: BosConfig | null;
  runtimeConfig: RuntimeConfig | null;
  configDir: string;
  databaseBindings: DatabaseBindingsService;
  drizzleKit: DrizzleKitService;
};

class BosDepsTag extends Context.Service<BosDepsTag, BosDeps>()("bos/BosDeps") {}

type PluginAttachmentConfig = NonNullable<BosConfig["plugins"]>[string];

function buildConfigResult(
  bosConfig: BosConfigInput | BosConfig | null,
  full = false,
): BosConfigResult {
  const packages =
    bosConfig?.app && typeof bosConfig.app === "object" ? Object.keys(bosConfig.app) : [];
  const remotes = packages.filter((name) => name !== "host");

  return {
    config: bosConfig ?? null,
    packages,
    remotes,
    full,
  };
}

function sanitizePluginKey(value: string): string {
  return value
    .replace(/[^A-Za-z0-9/_-]/g, "-")
    .replace(/\/+/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9_-]/g, "-"))
    .join("/")
    .replace(/^\/+|\/+$/g, "");
}

function defaultPluginKey(source: string): string {
  const normalized = source.replace(/^local:/, "").replace(/\/$/, "");
  if (source.startsWith("local:")) {
    return sanitizePluginKey(basename(normalized)) || "plugin";
  }

  try {
    const url = new URL(source);
    return sanitizePluginKey(basename(url.pathname) || url.hostname) || "plugin";
  } catch {
    return sanitizePluginKey(source) || "plugin";
  }
}

function pluginLocalPath(configDir: string, attachment: PluginAttachmentConfig): string | null {
  const ref = getPluginRef(attachment);
  const source = ref?.development ?? ref?.production;
  if (!source?.startsWith("local:")) {
    return null;
  }

  return join(configDir, source.slice("local:".length));
}

function listPluginAttachments(config: BosConfig | null) {
  return (Object.entries(config?.plugins ?? {}) as Array<[string, PluginAttachmentConfig]>)
    .map(([key, attachment]) => {
      const ref = getPluginRef(attachment);
      return {
        key,
        development: ref?.development,
        production: ref?.production,
        localPath: ref?.development?.startsWith("local:")
          ? ref.development.slice("local:".length)
          : undefined,
        source: ref?.development?.startsWith("local:") ? ("local" as const) : ("remote" as const),
        integrity: ref?.integrity,
        version: ref?.version,
        name: ref?.name,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function resolveRemoteConfigChain(
  accountId: string,
  gatewayId: string,
  visited: Set<string>,
  registry?: string,
): Promise<BosConfig> {
  const selfRef = `bos://${accountId}/${gatewayId}`;
  if (visited.has(selfRef)) {
    throw new Error(`Circular extends detected: ${selfRef}`);
  }

  const nextVisited = new Set(visited);
  nextVisited.add(selfRef);

  const config = await fetchBosConfigFromFastKv<BosConfigInput>(selfRef, registry);
  const parentRef = config.extends
    ? resolveExtendsRef(config.extends as string | ExtendsConfig, "production")
    : undefined;

  let merged: BosConfigInput;
  if (!parentRef) {
    merged = config;
  } else {
    const { accountId: parentAccountId, gatewayId: parentGatewayId } = parseBosUrl(parentRef);
    const parentResolved = await resolveRemoteConfigChain(
      parentAccountId,
      parentGatewayId,
      nextVisited,
      registry,
    );
    merged = mergeBosConfigWithExtends(parentResolved as BosConfigInput, config);
  }

  return resolveConfigComposableEntries(BosConfigSchema.parse(merged), process.cwd(), "production");
}

async function fetchPublishedConfig(
  accountId: string,
  gatewayId: string,
  registry?: string,
): Promise<BosConfig | null> {
  try {
    return await resolveRemoteConfigChain(accountId, gatewayId, new Set(), registry);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No config found")) {
      return null;
    }
    throw error;
  }
}

function resolveLoginSiteUrl(
  siteInput: string | undefined,
  deps: { bosConfig: BosConfig | null; runtimeConfig: RuntimeConfig | null },
  staging: boolean,
): string {
  if (siteInput) {
    return siteInput.replace(/\/+$/, "");
  }
  if (staging) {
    const stagingDomain = deps.bosConfig?.staging?.domain ?? deps.bosConfig?.domain;
    return stagingDomain ? `https://${stagingDomain}` : (deps.runtimeConfig?.ui?.url ?? "");
  }
  const devUiUrl = deps.runtimeConfig?.ui?.url;
  if (devUiUrl && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(devUiUrl)) {
    return devUiUrl.replace(/\/+$/, "");
  }
  const domain = deps.bosConfig?.domain;
  return domain ? `https://${domain}` : "";
}

async function exportPublishKey(
  account: string,
  registry: string | undefined,
): Promise<NonNullable<LoginResult["publishKey"]>> {
  if (!account) {
    throw new Error("bos.config.json has no account to export a publish key for");
  }

  await Effect.runPromise(ensureNearCli);

  const network = getNetworkIdForAccount(account);
  const contract = getRegistryNamespaceForAccount(account, registry);
  await listPublishKeys({ account, contract, network });

  const keyPair = generateNearKeyPair();
  await addFunctionCallAccessKey({
    account,
    contract,
    allowance: "1NEAR",
    functionNames: PUBLISH_FUNCTION_NAMES,
    network,
    keyPair,
  });

  const { FileKeyStore } = await import("near-kit/keys/file");
  const keyStore = new FileKeyStore("~/.near-credentials", network);
  await keyStore.add(account, parseNearPrivateKey(keyPair.privateKey));
  try {
    const { statSync, chmodSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const credentialPath = join(
      homedir(),
      ".near-credentials",
      network === "mainnet" ? "mainnet" : network,
      `${account}.json`,
    );
    if (statSync(credentialPath).mode & 0o077) {
      chmodSync(credentialPath, 0o600);
    }
  } catch {
    // best-effort tightening; near-kit owns the write path
  }

  return {
    publicKey: keyPair.publicKey,
    network,
    contract,
    exportedTo: nearCredentialsPath(network, account),
  };
}

function parseNearPrivateKey(privateKey: string): KeyPair {
  return parseKey(privateKey) as KeyPair;
}

async function revokeApiKey(credential: SessionCredential): Promise<boolean> {
  if (!credential.apiKey || !credential.siteUrl) return false;
  try {
    const response = await fetch(`${credential.siteUrl}/api/auth/api-key/delete`, {
      method: "POST",
      headers: {
        "x-api-key": credential.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ keyId: credential.apiKeyId }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default createPlugin({
  variables: z.object({
    configPath: z.string().optional(),
  }),
  secrets: z.object({}),
  contract: bosContract,
  initialize: (config, _plugins) =>
    Effect.gen(function* () {
      const base = yield* Effect.promise(async () => {
        const configResult = await loadResolvedConfig({
          path: config.variables.configPath,
        });
        return {
          bosConfig: configResult?.config ?? null,
          runtimeConfig: configResult?.runtime ?? null,
          configDir: getProjectRoot(),
        };
      });

      const projectEnv = yield* buildScoped(ProjectEnv, ProjectEnvLive);

      const services = yield* buildScopedContext(
        Layer.mergeAll(
          makeDatabaseBindings({
            projectDir: base.configDir,
            loadRuntimeConfig: async () =>
              (await loadResolvedConfig({ cwd: base.configDir }))?.runtime ?? null,
            loadEnv: () =>
              projectEnv.load(base.configDir).pipe(
                Effect.catchTag("EnvLoadError", (error) =>
                  Effect.fail(
                    new Error(
                      `failed to load .env: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`,
                    ),
                  ),
                ),
                Effect.runPromise,
              ),
          }),
          makeDrizzleKitLive({
            projectDir: base.configDir,
            onLog: (message) => p.log.info(message),
          }),
        ),
      );

      return Layer.succeed(BosDepsTag, {
        ...base,
        databaseBindings: Context.get(services, DatabaseBindings),
        drizzleKit: Context.get(services, DrizzleKit),
      } satisfies BosDeps);
    }),
  createRouter: (builder) => ({
    config: builder.config.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      if (input.full) {
        return buildConfigResult(deps.bosConfig, true);
      }

      const localConfig = await loadLocalConfig({ cwd: deps.configDir });
      return buildConfigResult(localConfig?.config ?? null, false);
    }),

    registryUse: builder.registryUse.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const generatedPath = getResolvedConfigPath(deps.configDir);
      const normalizedFrom = input.from.startsWith("bos://") ? input.from : `bos://${input.from}`;

      try {
        const remote = await fetchBosConfigFromFastKv<Record<string, unknown>>(normalizedFrom);
        const local = readGeneratedConfigFile(deps.configDir);
        if (!local) {
          return {
            status: "error" as const,
            from: normalizedFrom,
            applied: [],
            error: "No generated config found under .bos/ — run bos dev or bos publish first",
          };
        }
        const { meta, config } = local;
        const { config: merged, applied } = applyRegistrySections(
          config as never,
          remote as never,
          input.sections,
        );

        if (input.dryRun) {
          return {
            status: "dry-run" as const,
            from: normalizedFrom,
            applied,
            configPath: generatedPath,
          };
        }

        writeGeneratedConfigFile(deps.configDir, merged as Record<string, unknown>, meta);

        return {
          status: "updated" as const,
          from: normalizedFrom,
          applied,
          configPath: generatedPath,
        };
      } catch (error) {
        return {
          status: "error" as const,
          from: normalizedFrom,
          applied: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),

    pluginAdd: builder.pluginAdd.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          key: "",
          error: "No authored config (bos.app.ts or bos.config.json) found",
        };
      }

      const isBosRef = input.source.startsWith("bos://");
      const isLocal = input.source.startsWith("local:");
      const key = sanitizePluginKey(
        input.as ??
          (isBosRef ? (input.source.split("/").pop() ?? "plugin") : defaultPluginKey(input.source)),
      );
      const existing = deps.bosConfig.plugins?.[key];
      const existingEntry = existing && typeof existing === "object" ? existing : {};
      const nextPlugins = { ...deps.bosConfig.plugins };

      if (isBosRef) {
        nextPlugins[key] = {
          ...existingEntry,
          extends: input.source,
        };
      } else if (isLocal) {
        nextPlugins[key] = {
          ...existingEntry,
          development: input.source,
          ...(existingEntry.extends ? {} : {}),
        };
      } else {
        nextPlugins[key] = {
          ...existingEntry,
          production: input.production ?? input.source,
        };
      }

      deps.bosConfig = {
        ...deps.bosConfig,
        plugins: nextPlugins,
      };

      await saveBosConfig(deps.configDir, deps.bosConfig);
      await generateCodeArtifacts(deps.configDir, deps.bosConfig);

      const stored = deps.bosConfig.plugins?.[key];
      const storedObj = stored && typeof stored === "object" ? stored : {};

      return {
        status: "added" as const,
        key,
        development: storedObj.development,
        production: storedObj.production,
        integrity: storedObj.integrity,
        version: storedObj.version,
      };
    }),

    pluginRemove: builder.pluginRemove.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          key: input.key,
          error: "No authored config (bos.app.ts or bos.config.json) found",
        };
      }

      if (!deps.bosConfig.plugins?.[input.key]) {
        return {
          status: "error" as const,
          key: input.key,
          error: `Plugin '${input.key}' is not configured`,
        };
      }

      const nextPlugins = { ...deps.bosConfig.plugins };
      delete nextPlugins[input.key];
      deps.bosConfig = {
        ...deps.bosConfig,
        plugins: Object.keys(nextPlugins).length > 0 ? nextPlugins : undefined,
      };

      await saveBosConfig(deps.configDir, deps.bosConfig);
      await generateCodeArtifacts(deps.configDir, deps.bosConfig);

      return {
        status: "removed" as const,
        key: input.key,
      };
    }),

    pluginList: builder.pluginList.handler(async ({ context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const plugins: PluginListResult["plugins"] = listPluginAttachments(deps.bosConfig);
      return {
        status: "listed" as const,
        plugins,
      };
    }),

    pluginPublish: builder.pluginPublish.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          key: input.key,
          error: "No authored config (bos.app.ts or bos.config.json) found",
        };
      }

      const attachment = deps.bosConfig.plugins?.[input.key];
      if (!attachment) {
        return {
          status: "error" as const,
          key: input.key,
          error: `Plugin '${input.key}' is not configured`,
        };
      }

      const attachmentRef = getPluginRef(attachment);

      const localPath = pluginLocalPath(deps.configDir, attachment);
      if (!localPath) {
        return {
          status: "error" as const,
          key: input.key,
          error: `Plugin '${input.key}' does not have a local development path`,
        };
      }

      const pkgPath = join(localPath, "package.json");
      if (!(await fileExists(pkgPath))) {
        return {
          status: "error" as const,
          key: input.key,
          error: `Missing package.json at ${localPath}`,
        };
      }

      const pkgJson = await readJsonFile<{
        scripts?: Record<string, string>;
        name?: string;
        version?: string;
      }>(pkgPath);

      const { stdout, stderr, exitCode } = (await run("bun", ["run", "build"], {
        cwd: localPath,
        capture: true,
      })) as { stdout: string; stderr: string; exitCode: number };

      if (exitCode !== 0) {
        if (stdout.trim()) process.stdout.write(stdout);
        if (stderr.trim()) process.stderr.write(stderr);
        return {
          status: "error" as const,
          key: input.key,
          error: `Build failed with exit code ${exitCode}`,
        };
      }

      const account = deps.bosConfig.account;
      const gateway = deps.bosConfig.domain;
      if (!account || !gateway) {
        return {
          status: "error" as const,
          key: input.key,
          error: "bos.config.json must define account and domain to publish a plugin",
        };
      }

      let publishedUrl: string | undefined;
      try {
        const local = readGeneratedConfigFile(deps.configDir);
        if (!local) throw new Error("No generated config under .bos/ — run bos dev first");
        const merged = applyPluginPublishUrl(local.config, {
          origin: `https://${gateway}`,
          account,
          gateway,
          key: input.key,
        });
        writeGeneratedConfigFile(deps.configDir, merged, local.meta);
        const plugins = merged.plugins as Record<string, Record<string, unknown>> | undefined;
        publishedUrl = plugins?.[input.key]?.production as string | undefined;
        console.log(`   ✅ Updated generated config: plugins.${input.key}.production`);
      } catch (err) {
        console.error(
          `   ❌ Failed to update the generated config:`,
          err instanceof Error ? err.message : err,
        );
      }

      let manifest: PluginManifest | null = null;
      if (publishedUrl) {
        manifest = await fetchRemotePluginManifest(publishedUrl);
      } else if (attachmentRef?.production) {
        manifest = await fetchRemotePluginManifest(attachmentRef.production);
        if (manifest) {
          publishedUrl = attachmentRef.production;
        }
      }

      const version = manifest?.plugin.version ?? pkgJson.version;

      if (publishedUrl) {
        await generateCodeArtifacts(deps.configDir, deps.bosConfig);
      }

      return {
        status: "published" as const,
        key: input.key,
        path: localPath,
        script: "build",
        production: publishedUrl ?? attachmentRef?.production,
        version: version ?? undefined,
      };
    }),

    dev: builder.dev.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const devTimings: PhaseTiming[] = [];

      const outcome = await Effect.runPromise(
        devBootstrap(deps, input, devTimings, { resolveProxyUrl }).pipe(
          Effect.provide(bootstrapLayers),
          Effect.catchTags({
            DevConfigMissing: () => Effect.succeed({ failed: "No authored config (bos.app.ts or bos.config.json) found" }),
            DevProxyMissing: () =>
              Effect.succeed({ failed: "No valid proxy URL configured in bos.config.json" }),
            DevPreflightFailed: (error) =>
              Effect.succeed({ failed: `Infra preflight failed: ${error.messages.join("; ")}` }),
          }),
        ),
      );

      if ("failed" in outcome) {
        return {
          status: "error" as const,
          description: outcome.failed,
          processes: [],
          timings: devTimings,
        };
      }

      pendingSession = outcome.session;

      return {
        status: "started" as const,
        description: outcome.description,
        processes: outcome.processes,
        timings: devTimings,
      };
    }),

    start: builder.start.handler(async ({ input, context }) => {
      const baseDeps = Context.get(context["effect/context"], BosDepsTag);
      let deps = baseDeps;
      if (input.configPath) {
        const override = await loadResolvedConfig({ path: input.configPath });
        if (!override?.config) {
          return {
            status: "error" as const,
            url: "",
            error: `No config found at ${input.configPath}`,
          };
        }
        deps = { ...baseDeps, bosConfig: override.config };
      }

      const outcome = await Effect.runPromise(
        startBootstrap(deps, input, { resolveProxyUrl, fetchPublishedConfig }).pipe(
          Effect.provide(bootstrapLayers),
          Effect.catchTags({
            StartRemoteConfigMissing: (error) => Effect.succeed({ failed: error.message }),
            StartFetchFailed: (error) => Effect.succeed({ failed: error.message }),
            StartConfigMissing: () =>
              Effect.succeed({
                failed:
                  "No configuration found. Provide --account and --gateway flags, or create a local bos.config.json.",
              }),
            InfraError: (error) => Effect.succeed({ failed: `${error.phase}: ${error.message}` }),
            DevStepError: (error) =>
              Effect.succeed({
                failed: `${error.phase} failed: ${
                  error.cause instanceof Error ? error.cause.message : String(error.cause)
                }`,
              }),
          }),
        ),
      );

      if ("failed" in outcome) {
        return {
          status: "error" as const,
          url: "",
          error: outcome.failed,
        };
      }

      pendingSession = outcome.session;
      pendingStartSummary = outcome.summary;

      return {
        status: "running" as const,
        url: outcome.url,
      };
    }),

    build: builder.build.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          error: "No authored config (bos.app.ts or bos.config.json) found",
          built: [],
          skipped: [],
        };
      }

      const buildEnv: BosEnv = input.deploy ? "production" : "development";

      const targets = selectWorkspaceTargets(input.packages, deps.bosConfig);
      if (targets.length === 0) {
        const allPackages = [
          ...Object.keys(deps.bosConfig.app ?? {}),
          ...Object.keys(deps.bosConfig.plugins ?? {}),
        ];
        return {
          status: "error" as const,
          error: `Unknown build target(s): ${input.packages} — valid targets: ${allPackages.join(", ") || "none"} (framework packages build via the prerequisite train: bun run build <target>)`,
          built: [],
          skipped: [],
        };
      }

      suppressWarnings();
      const runtimeConfig = await buildRuntimeConfig(deps.bosConfig, {
        uiSource: deps.bosConfig.app.ui?.development ? "local" : "remote",
        apiSource: deps.bosConfig.app.api?.development ? "local" : "remote",
        authSource: deps.bosConfig.app.auth?.development ? "local" : "remote",
        hostSource: deps.bosConfig.app.host?.development ? "local" : "remote",
        env: buildEnv,
        plugins: deps.runtimeConfig?.plugins,
      });
      drainConfigWarnings();
      resumeWarnings();

      await generateCodeArtifacts(deps.configDir, deps.bosConfig, {
        env: buildEnv,
        runtimeConfig,
      });

      const { built, skipped } = await buildWorkspaceTargets({
        configDir: deps.configDir,
        bosConfig: deps.bosConfig,
        runtimeConfig: runtimeConfig,
        targets,
        deploy: input.deploy,
      });

      if (built.length === 0) {
        return {
          status: "error" as const,
          error: `Nothing to build — no local targets matched${skipped.length > 0 ? `: ${skipped.join(", ")}` : ""}`,
          built: [],
          skipped,
        };
      }

      return {
        status: "success" as const,
        built,
        skipped,
        deployed: input.deploy,
      };
    }),

    publish: builder.publish.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: "No authored config (bos.app.ts or bos.config.json) found",
        };
      }

      const result = await publishToFastKv({
        bosConfig: deps.bosConfig,
        runtimeConfig: deps.runtimeConfig,
        configDir: deps.configDir,
        env: input.env,
        build: input.deploy,
        dryRun: input.dryRun,
        verbose: input.verbose,
        packages: input.packages,
        network: input.network,
        privateKey: input.privateKey,
        wallet: input.wallet,
        registry: input.registry,
      });

      if (result.publishConfig) {
        const refreshed = await loadResolvedConfig({ cwd: deps.configDir });
        if (refreshed?.config) {
          deps.bosConfig = refreshed.config;
          deps.runtimeConfig = refreshed.runtime;
        }
      }

      return {
        status: result.status,
        registryUrl: result.registryUrl,
        txHash: result.txHash,
        error: result.error,
        built: result.built,
        skipped: result.skipped,
        deployResults: result.deployResults,
      };
    }),

    deploy: builder.deploy.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          registryUrl: "",
          redeployed: false,
          error: "No authored config (bos.app.ts or bos.config.json) found",
        };
      }

      const result = await publishToFastKv({
        bosConfig: deps.bosConfig,
        runtimeConfig: deps.runtimeConfig,
        configDir: deps.configDir,
        env: input.env,
        build: input.build,
        dryRun: input.dryRun,
        verbose: input.verbose,
        packages: input.packages,
        network: input.network,
        privateKey: input.privateKey,
        registry: input.registry,
      });

      if (result.status === "error") {
        return {
          status: "error" as const,
          registryUrl: result.registryUrl,
          txHash: result.txHash,
          built: result.built,
          skipped: result.skipped,
          redeployed: false,
          error: result.error,
          deployResults: result.deployResults,
        };
      }

      if (result.status === "dry-run") {
        return {
          status: "dry-run" as const,
          registryUrl: result.registryUrl,
          built: result.built,
          skipped: result.skipped,
          redeployed: false,
        };
      }

      if (result.publishConfig) {
        const refreshed = await loadResolvedConfig({ cwd: deps.configDir });
        if (refreshed?.config) {
          deps.bosConfig = refreshed.config;
          deps.runtimeConfig = refreshed.runtime;
        }
      }

      let redeployed = false;
      let service: string | undefined;

      if (process.env.RAILWAY_TOKEN) {
        const railwayService = input.service ?? deps.bosConfig.ci?.railway?.service;
        if (!railwayService) {
          console.log();
          console.log(
            colors.yellow(
              "  Railway redeploy skipped: ci.railway.service is not configured in bos.config.json",
            ),
          );
          return {
            status: "published" as const,
            registryUrl: result.registryUrl,
            txHash: result.txHash,
            built: result.built,
            skipped: result.skipped,
            redeployed: false,
            deployResults: result.deployResults,
            error:
              "Config published but Railway redeploy failed: ci.railway.service is not configured in bos.config.json",
          };
        }

        service = railwayService;
        console.log();
        console.log(`  Redeploying Railway service ${colors.cyan(railwayService)}...`);
        try {
          const railResult = await run(
            "railway",
            ["redeploy", "--service", railwayService, "--yes"],
            {
              capture: true,
            },
          );
          if (railResult?.stdout) {
            for (const line of railResult.stdout.split("\n")) {
              if (line.trim()) console.log(`  ${colors.dim(line.trim())}`);
            }
          }
          redeployed = true;
          console.log(colors.green(`  Railway redeploy complete`));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const railError =
            message.includes("not found") || message.includes("ENOENT")
              ? "Railway CLI not found. Install it: npm i -g @railway/cli"
              : `Railway redeploy failed: ${message}`;
          console.log(colors.yellow(`  ${railError}`));
          return {
            status: "published" as const,
            registryUrl: result.registryUrl,
            txHash: result.txHash,
            built: result.built,
            skipped: result.skipped,
            redeployed: false,
            service,
            deployResults: result.deployResults,
            error: `Config published but ${railError}`,
          };
        }
      } else {
        console.log();
        console.log(colors.yellow("  Railway redeploy skipped (RAILWAY_TOKEN not set)"));
      }

      return {
        status: "deployed" as const,
        registryUrl: result.registryUrl,
        txHash: result.txHash,
        built: result.built,
        skipped: result.skipped,
        redeployed,
        service,
        deployResults: result.deployResults,
      };
    }),

    keyPublish: builder.keyPublish.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          account: "",
          network: "mainnet" as const,
          env: input.env,
          contract: "",
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          error: "No authored config (bos.app.ts or bos.config.json) found",
        };
      }

      const account =
        input.env === "staging"
          ? (deps.bosConfig.staging?.account ?? deps.bosConfig.account)
          : deps.bosConfig.account;
      const network = getNetworkIdForAccount(account);
      const contract = getRegistryNamespaceForAccount(account, input.registry);
      try {
        await Effect.runPromise(ensureNearCli);

        const oldKeys = await listPublishKeys({ account, contract, network });

        const keyPair = await addFunctionCallAccessKey({
          account,
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          network,
        });

        if (oldKeys.length > 0) {
          console.log();
          console.log(
            `  Found ${oldKeys.length} existing publish key${oldKeys.length > 1 ? "s" : ""}:`,
          );
          for (const k of oldKeys) {
            console.log(`    ${colors.dim(k)}`);
          }

          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const answer = await rl.question("  Remove old key(s)? [Y/n] ");
          rl.close();

          if (answer.toLowerCase() !== "n" && answer.toLowerCase() !== "no") {
            try {
              await deleteAccessKeys(account, oldKeys, network);
              console.log(
                `  ${colors.green("✓")} Removed ${oldKeys.length} old key${
                  oldKeys.length > 1 ? "s" : ""
                }`,
              );
            } catch {
              console.log(
                `  ${colors.yellow("⚠")} Failed to remove old key${
                  oldKeys.length > 1 ? "s" : ""
                } (new key still active)`,
              );
            }
          } else {
            console.log(`  ${colors.dim("Old key(s) retained.")}`);
          }
        }

        return {
          status: "published" as const,
          account,
          network,
          env: input.env,
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          publicKey: keyPair.publicKey,
          privateKey: keyPair.privateKey,
        };
      } catch (error) {
        return {
          status: "error" as const,
          account,
          network,
          env: input.env,
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    login: builder.login.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const staging = input.env === "staging";
      const account = staging
        ? (deps.bosConfig?.staging?.account ?? deps.bosConfig?.account ?? "")
        : (deps.bosConfig?.account ?? "");

      try {
        const siteUrl = resolveLoginSiteUrl(input.site, deps, staging);
        const login = await startDeviceLogin({
          siteUrl,
          device: input.device,
          account: account || undefined,
          expiresIn: input.expiresIn,
        });

        console.log();
        console.log(`  One-time code: ${colors.cyan(login.userCode)}`);
        await openInBrowser(login.verificationUrl).catch((error: unknown) => {
          console.log(colors.yellow(`  ⚠ ${(error as Error).message}`));
        });
        console.log();
        console.log(`  Waiting for approval at ${colors.dim(login.verificationUrl)}…`);

        const approval = await login.waitForApproval();

        if (!approval.apiKey) {
          return {
            status: "error" as const,
            siteUrl,
            loginUrl: login.verificationUrl,
            error: "Login approved but no CLI credential was created",
          };
        }

        const expiresAt = new Date(Date.now() + input.expiresIn * 1000).toISOString();
        writeSessionHandle(deps.configDir, {
          version: 1,
          credential: {
            kind: "session",
            apiKey: approval.apiKey.key,
            apiKeyId: approval.apiKey.id,
            accountId: approval.accountId,
            label: input.device ?? siteUrl,
            siteUrl,
            createdAt: new Date().toISOString(),
            expiresAt,
          },
          publishKey: null,
          delegateKey: null,
        });

        let warning: string | null = null;
        if (account && approval.accountId && approval.accountId !== account) {
          warning = `Logged in as ${approval.accountId}, but bos.config.json account is ${account}. Publishes will use the configured account.`;
        }

        let publishKey: LoginResult["publishKey"] = null;
        if (input.key) {
          try {
            publishKey = await exportPublishKey(account, input.registry);
          } catch (error) {
            warning = `Session stored, but publish-key export failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`;
          }
        }

        return {
          status: "logged-in" as const,
          siteUrl,
          accountId: approval.accountId,
          expiresAt,
          loginUrl: login.verificationUrl,
          publishKey,
          warning,
        };
      } catch (error) {
        return {
          status: "error" as const,
          siteUrl: input.site ?? "",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    logout: builder.logout.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const configDir = input.configDir ?? deps.configDir;

      try {
        const session = readSessionHandle(configDir);
        let revokedApiKey = false;
        let removedPublishKey = false;
        let warning: string | null = null;

        if (session?.credential) {
          revokedApiKey = await revokeApiKey(session.credential).catch(() => false);
          if (!revokedApiKey) {
            warning =
              "Could not revoke the API key remotely — revoke it manually under Settings → API keys.";
          }
        }

        if (session?.publishKey) {
          const account = session.credential?.accountId ?? deps.bosConfig?.account ?? "";
          removePublishedKeyFile(session.publishKey.network, account, session.publishKey.publicKey);
          removedPublishKey = true;
          warning = warning
            ? `${warning} Re-run ${colors.cyan("bos login --key")} to re-export a publish key.`
            : "Removed the exported publish key. Re-run bos login --key to re-export one.";
        }

        deleteSessionHandle(configDir);
        return {
          status: "logged-out" as const,
          revokedApiKey,
          removedPublishKey,
          warning,
        };
      } catch (error) {
        return {
          status: "error" as const,
          revokedApiKey: false,
          removedPublishKey: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    init: builder.init.handler(async ({ input }) => {
      try {
        const timings: PhaseTiming[] = [];
        let extendsAccount = "";
        let extendsGateway = "";
        let directory = input.directory;
        const account = input.account;
        const domain = input.domain;
        let overrides = input.overrides as OverrideSection[] | undefined;
        let plugins = input.plugins;

        if (input.extends) {
          const normalized = input.extends.startsWith("bos://")
            ? input.extends
            : `bos://${input.extends}`;
          const match = normalized.match(/^bos:\/\/([^/]+)\/(.+)$/);
          if (match) {
            extendsAccount = match[1];
            extendsGateway = match[2];
          }
        }

        extendsAccount = extendsAccount || "dev.everything.near";
        extendsGateway = extendsGateway || "everything.dev";

        let parentPluginKeys: string[] = [];
        let parentConfig: BosConfig | null = null;
        try {
          parentConfig = await timePhase(timings, "parent config", () =>
            fetchParentConfig(extendsAccount, extendsGateway),
          );
          if (parentConfig?.plugins && typeof parentConfig.plugins === "object") {
            parentPluginKeys = Object.keys(parentConfig.plugins);
          }
        } catch (e) {
          console.warn(
            `[init] Failed to fetch parent config from ${extendsAccount}/${extendsGateway}: ${
              e instanceof Error ? e.message : e
            }`,
          );
        }

        overrides = overrides?.length ? overrides : (["ui", "api"] as OverrideSection[]);
        if (overrides.includes("plugins") && plugins === undefined) {
          plugins = parentPluginKeys;
        }
        plugins = plugins ?? [];

        const pluginDirMap: Record<string, string> = {};
        if (parentConfig?.plugins) {
          for (const plugin of plugins) {
            const entry = (parentConfig.plugins as Record<string, unknown>)?.[plugin];
            if (entry && typeof entry === "object") {
              const dev = (entry as Record<string, unknown>).development;
              if (typeof dev === "string") {
                const match = dev.match(/^local:plugins\/(.+)$/);
                if (match?.[1] && match[1] !== plugin) pluginDirMap[plugin] = match[1];
              }
            }
          }
        }

        directory = directory || domain || extendsGateway;
        const targetDir = resolve(directory);
        const extendsRef = `bos://${extendsAccount}/${extendsGateway}`;

        const repository =
          (await detectGitRemoteUrl(process.cwd()).catch(() => undefined)) ??
          parentConfig?.repository;

        if (!parentConfig) {
          try {
            parentConfig = await timePhase(timings, "parent config", () =>
              fetchParentConfig(extendsAccount, extendsGateway),
            );
          } catch {
            return {
              status: "error" as const,
              directory,
              extendsRef,
              account,
              domain,
              extends: extendsRef,
              plugins,
              overrides,
              filesCopied: 0,
              timings,
              error: `No config found at ${extendsRef} — are you sure this is the right parent?`,
            };
          }
        }

        const {
          sourceDir,
          parentConfig: resolvedParentConfig,
          cleanup,
        } = await timePhase(timings, "template source", () =>
          resolveSourceDir({
            extendsAccount,
            extendsGateway,
            source: input.source,
          }),
        );

        parentConfig = resolvedParentConfig;

        const isMinimalScaffold = sourceDir === "";

        try {
          let filesCopied: number;
          let childBosConfig: BosConfigInput | null = null;

          if (isMinimalScaffold) {
            filesCopied = await timePhase(timings, "scaffold project", () =>
              scaffoldMinimalProject(targetDir, parentConfig as unknown as BosConfigInput, {
                extendsAccount,
                extendsGateway,
                account: account || extendsAccount,
                domain,
                plugins,
                overrides,
                repository,
                title: parentConfig?.title,
                description: parentConfig?.description,
              }),
            );

            await timePhase(timings, "personalize config", () =>
              personalizeConfig(targetDir, {
                extendsAccount,
                extendsGateway,
                account: account || extendsAccount,
                domain: domain || extendsGateway,
                plugins,
                overrides,
                mode: "init",
                repository,
                title: parentConfig?.title,
                description: parentConfig?.description,
                testnet: parentConfig?.testnet,
                staging: parentConfig?.staging,
              }),
            );

            childBosConfig = await timePhase(timings, "authored config form", () =>
              convertChildConfigToAppForm(targetDir),
            );
          } else {
            const patterns = buildInitPatterns(overrides, plugins, pluginDirMap);
            const routeExclusions = overrides.includes("ui")
              ? buildPluginRouteExclusions(parentConfig, plugins)
              : [];

            filesCopied = await timePhase(timings, "copy files", () =>
              copyFilteredFiles(sourceDir, targetDir, patterns, {
                overrides,
                plugins,
                ignore: routeExclusions,
              }),
            );

            await timePhase(timings, "personalize config", () =>
              personalizeConfig(targetDir, {
                extendsAccount,
                extendsGateway,
                account: account || extendsAccount,
                domain: domain || extendsGateway,
                plugins,
                overrides,
                workspaceOpts: { sourceDir },
                repository,
                title: parentConfig?.title,
                description: parentConfig?.description,
                testnet: parentConfig?.testnet,
                staging: parentConfig?.staging,
              }),
            );

            childBosConfig = await timePhase(timings, "authored config form", () =>
              convertChildConfigToAppForm(targetDir),
            );

            if (overrides.includes("ui")) {
              await timePhase(timings, "prune unused ui files", async () =>
                pruneUnusedUiFiles(targetDir, { log: console.log }),
              );
            }

            await timePhase(timings, "write snapshot", () =>
              writeInitSnapshot(targetDir, extendsAccount, extendsGateway, sourceDir, patterns, {
                overrides,
                plugins,
                ignore: routeExclusions,
              }),
            );

            await timePhase(timings, "personalize agents", () =>
              personalizeAgentsMd(targetDir, { overrides, plugins }),
            );
          }

          await timePhase(timings, "sync shared deps", () =>
            syncResolvedSharedDeps({
              configDir: targetDir,
              hostMode: "local",
              bosConfig: childBosConfig
                ? (childBosConfig as unknown as Record<string, unknown>)
                : undefined,
            }),
          );

          const lockfilePath = join(targetDir, "bun.lock");
          const allowedWorkspaces = computeAllowedWorkspaces(overrides, plugins);
          stripOrphanedWorkspacesFromLockfile(lockfilePath, allowedWorkspaces);
          removeInitLockfile(lockfilePath);

          const initConfig = await timePhase(timings, "resolve config", () =>
            loadResolvedConfig({ cwd: targetDir }).catch((error) => {
              console.warn(
                "[init] Skipping config resolution — the child has no node_modules yet; `bos dev` resolves after `bun install`.",
                error instanceof Error ? error.message : error,
              );
              return null;
            }),
          );
          if (initConfig?.runtime) {
            await timePhase(timings, "generate env/docker", async () => {
              await materializeViaLayer(targetDir, initConfig.runtime);
            });
          }
          await timePhase(timings, "create env file", async () => {
            await Effect.runPromise(makeProjectEnv().ensureFile(targetDir));
          });

          if (!input.noInstall) {
            await timePhase(timings, "install dependencies", () => runBunInstall(targetDir));
            await timePhase(timings, "generate types", () => runTypesGen(targetDir));
            await timePhase(timings, "generate migrations", () =>
              generateDatabaseMigrations(targetDir),
            );
          }

          if (input.noInstall && initConfig?.config) {
            await timePhase(timings, "generate code artifacts", () =>
              generateCodeArtifacts(targetDir, initConfig.config),
            );
          }

          return {
            status: "initialized" as const,
            directory,
            extendsRef,
            account,
            domain,
            extends: extendsRef,
            plugins,
            overrides,
            filesCopied,
            timings,
            targetDir,
          };
        } finally {
          await cleanup();
        }
      } catch (error) {
        const extendsRef = input.extends
          ? input.extends.startsWith("bos://")
            ? input.extends
            : `bos://${input.extends}`
          : "bos://dev.everything.near/everything.dev";
        return {
          status: "error" as const,
          directory: input.directory ?? "",
          extendsRef,
          account: input.account,
          domain: input.domain,
          extends: extendsRef,
          plugins: input.plugins ?? [],
          overrides: input.overrides,
          filesCopied: 0,
          timings: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    sync: builder.sync.handler(async ({ input }) => {
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            updated: [],
            skipped: [],
            added: [],
            error: "No authored config (bos.app.ts or bos.config.json) found",
          };
        }

        const projectDir = resolve(dirname(configPath));
        const result = await syncTemplate(projectDir, input);

        if (result.status === "synced" || result.status === "dry-run") {
          const syncedConfig = await loadResolvedConfig({ cwd: projectDir });
          if (syncedConfig?.config) {
            await generateCodeArtifacts(projectDir, syncedConfig.config);
          }
        }

        return result;
      } catch (error) {
        return {
          status: "error" as const,
          updated: [],
          skipped: [],
          added: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    upgrade: builder.upgrade.handler(async ({ input }) => {
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            packages: [],
            error: "No authored config (bos.app.ts or bos.config.json) found",
          };
        }

        const projectDir = resolve(dirname(configPath));
        return await upgradeTemplate(projectDir, input);
      } catch (error) {
        return {
          status: "error" as const,
          packages: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    typesGen: builder.typesGen.handler(async ({ input }) => {
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            generated: [],
            fetched: [],
            skipped: [],
            failed: [],
            error: "No authored config (bos.app.ts or bos.config.json) found",
          };
        }

        const projectDir = resolve(dirname(configPath));
        const env =
          input.env ?? (process.env.NODE_ENV === "production" ? "production" : "development");

        const refreshed = await loadResolvedConfig({
          cwd: projectDir,
          env,
          remotePlugins: input.remotePlugins,
        });
        if (!refreshed) {
          return {
            status: "error" as const,
            generated: [],
            fetched: [],
            skipped: [],
            failed: [],
            error: "Failed to load bos.config.json",
          };
        }

        if (input.dryRun) {
          const pluginEntries = Object.entries(refreshed.runtime.plugins ?? {});
          const fetched: string[] = [];
          const skipped: string[] = [];
          const hasLocalApiWorkspace = existsSync(join(projectDir, "api", "src"));

          if (refreshed.runtime.api.source !== "local") {
            fetched.push(`api remote (${refreshed.runtime.api.url})`);
          } else {
            const path = refreshed.runtime.api.localPath
              ? ` (${relative(projectDir, refreshed.runtime.api.localPath)})`
              : "";
            skipped.push(`api local${path}`);
          }

          if (refreshed.runtime.auth) {
            if (refreshed.runtime.auth.source !== "local") {
              fetched.push(`auth remote (${refreshed.runtime.auth.url})`);
            } else {
              const path = refreshed.runtime.auth.localPath
                ? ` (${relative(projectDir, refreshed.runtime.auth.localPath)})`
                : "";
              skipped.push(`auth local${path}`);
            }
          }

          for (const [key, plugin] of pluginEntries) {
            if (plugin.url && plugin.source !== "local") {
              fetched.push(`${key} remote (${plugin.url})`);
            } else if (plugin.localPath) {
              skipped.push(`${key} local (${relative(projectDir, plugin.localPath)})`);
            } else {
              skipped.push(`${key} no URL resolved`);
            }
          }

          const generated = ["ui/src/lib/api-types.gen.ts", "ui/src/lib/auth-types.gen.ts"];
          if (hasLocalApiWorkspace) {
            generated.push("api/src/lib/plugins-types.gen.ts", "api/src/lib/auth-types.gen.ts");
          }
          if (existsSync(join(projectDir, "host", "src"))) {
            generated.push("host/src/lib/auth-types.gen.ts");
          }
          for (const [_key, plugin] of pluginEntries) {
            const localPath = plugin.localPath;
            if (!localPath) continue;
            const pluginSrc = join(localPath, "src", "lib", "plugins-client.gen.ts");
            if (existsSync(pluginSrc)) {
              generated.push(relative(projectDir, pluginSrc));
            }
          }
          if (refreshed.runtime.auth?.localPath) {
            const authSrc = join(
              refreshed.runtime.auth.localPath,
              "src",
              "lib",
              "plugins-client.gen.ts",
            );
            if (existsSync(authSrc)) {
              generated.push(relative(projectDir, authSrc));
            }
          }

          return {
            status: "success" as const,
            generated,
            fetched,
            skipped,
            failed: [],
          };
        }

        const artifacts = await generateCodeArtifacts(projectDir, refreshed.config, {
          runtimeConfig: refreshed.runtime,
        });

        const hasLocalApiWorkspace = existsSync(join(projectDir, "api", "src"));
        const generated = ["ui/src/lib/api-types.gen.ts"];
        if (hasLocalApiWorkspace) {
          generated.push("api/src/lib/plugins-types.gen.ts", "api/src/lib/auth-types.gen.ts");
        }
        if (
          refreshed.runtime.auth &&
          (refreshed.runtime.auth.source !== "local" || refreshed.runtime.auth.localPath)
        ) {
          generated.push("ui/src/lib/auth-types.gen.ts");
        }
        if (existsSync(join(projectDir, "host", "src"))) {
          generated.push("host/src/lib/auth-types.gen.ts");
        }
        for (const [_key, plugin] of Object.entries(refreshed.runtime.plugins ?? {})) {
          const localPath = plugin.localPath;
          if (!localPath) continue;
          const pluginSrc = join(localPath, "src", "lib", "plugins-client.gen.ts");
          if (existsSync(pluginSrc)) {
            generated.push(relative(projectDir, pluginSrc));
          }
        }
        if (refreshed.runtime.auth?.localPath) {
          const authSrc = join(
            refreshed.runtime.auth.localPath,
            "src",
            "lib",
            "plugins-client.gen.ts",
          );
          if (existsSync(authSrc)) {
            generated.push(relative(projectDir, authSrc));
          }
        }

        const contractStatus = artifacts?.contractStatus ?? [];
        const fetched: string[] = [];
        const skipped: string[] = [];
        const failed: string[] = [];
        for (const entry of contractStatus) {
          if (entry.source === "remote") {
            fetched.push(entry.url ? `${entry.key} remote (${entry.url})` : entry.key);
          } else if (entry.source === "local") {
            const path = entry.localPath ? ` (${relative(projectDir, entry.localPath)})` : "";
            skipped.push(`${entry.key} local${path}`);
          } else if (entry.source === "skipped") {
            skipped.push(`${entry.key} no URL resolved`);
          } else if (entry.source === "failed") {
            const detail = entry.error ? `: ${entry.error}` : "";
            failed.push(`${entry.key}${detail}`);
          }
        }

        return {
          status: "success" as const,
          generated,
          fetched,
          skipped,
          failed,
        };
      } catch (error) {
        return {
          status: "error" as const,
          generated: [],
          fetched: [],
          skipped: [],
          failed: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    typecheck: builder.typecheck.handler(async ({ input }) => {
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            checked: [],
            skipped: [],
            results: [],
            error: "No authored config (bos.app.ts or bos.config.json) found",
          };
        }

        const projectDir = resolve(dirname(configPath));
        const refreshed = await loadResolvedConfig({ cwd: projectDir });
        if (!refreshed) {
          return {
            status: "error" as const,
            checked: [],
            skipped: [],
            results: [],
            error: "Failed to load bos.config.json",
          };
        }

        await generateCodeArtifacts(projectDir, refreshed.config, {
          runtimeConfig: refreshed.runtime,
        });

        const runtime = refreshed.runtime;
        type AppTarget = { source?: string; localPath?: string };
        const workspaceEntries: Array<{
          key: string;
          label: string;
          dir: string;
        }> = [];
        const skipped: Array<{ key: string; label: string }> = [];

        const appTargets: Array<{
          key: string;
          label: string;
          target: AppTarget | undefined;
        }> = [
          { key: "host", label: "host", target: runtime.host },
          { key: "ui", label: "ui", target: runtime.ui },
          { key: "api", label: "api", target: runtime.api },
        ];
        if (runtime.auth) {
          appTargets.push({ key: "auth", label: "auth", target: runtime.auth });
        }

        for (const entry of appTargets) {
          if (
            entry.target?.source === "local" &&
            entry.target.localPath &&
            existsSync(join(entry.target.localPath, "tsconfig.json"))
          ) {
            workspaceEntries.push({
              key: entry.key,
              label: entry.label,
              dir: entry.target.localPath,
            });
          } else {
            skipped.push({ key: entry.key, label: entry.label });
          }
        }

        for (const [key, plugin] of Object.entries(runtime.plugins ?? {})) {
          const label = `plugins/${key}`;
          if (
            plugin.source === "local" &&
            plugin.localPath &&
            existsSync(join(plugin.localPath, "tsconfig.json"))
          ) {
            workspaceEntries.push({ key, label, dir: plugin.localPath });
          } else {
            skipped.push({ key, label });
          }
        }

        const selected = selectWorkspaceTargets(input.packages, refreshed.config);
        const targets =
          input.packages === "all"
            ? workspaceEntries
            : workspaceEntries.filter((entry) => selected.includes(entry.key));
        const skippedEntries =
          input.packages === "all"
            ? skipped
            : skipped.filter((entry) => selected.includes(entry.key));

        const checked: string[] = [];
        const results: Array<{
          workspace: string;
          passed: boolean;
          error?: string;
        }> = [];

        for (const entry of targets) {
          const packageJsonPath = join(entry.dir, "package.json");
          let args: string[] = ["run", "tsc", "--noEmit"];
          if (existsSync(packageJsonPath)) {
            try {
              const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
                scripts?: Record<string, string>;
              };
              if (pkg.scripts?.typecheck) {
                args = ["run", "typecheck"];
              }
            } catch {
              // ignore unreadable package.json
            }
          }

          console.log(`\n  ${colors.dim("Checking")} ${colors.cyan(entry.label)}`);
          const child = spawnSync("bun", args, {
            cwd: entry.dir,
            stdio: "inherit",
          });
          const passed = child.status === 0;
          checked.push(entry.label);
          results.push({
            workspace: entry.label,
            passed,
            error: passed ? undefined : `typecheck failed (exit code ${child.status ?? "n/a"})`,
          });
        }

        return {
          status: "success" as const,
          checked,
          skipped: skippedEntries.map((entry) => entry.label),
          results,
        };
      } catch (error) {
        return {
          status: "error" as const,
          checked: [],
          skipped: [],
          results: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    mfCheck: builder.mfCheck.handler(async ({ input }) => {
      const configPath = findConfigPath();
      if (!configPath) {
        return {
          status: "fail" as const,
          hostVersion: null,
          hostReachable: false,
          hostReason: "No authored config (bos.app.ts or bos.config.json) found",
          remotes: [],
        };
      }

      const configDir = dirname(configPath);
      let bosConfig: BosConfig | null = loadGeneratedResolvedConfig(configDir);
      if (!bosConfig) {
        try {
          const loaded = await loadResolvedConfig({ cwd: configDir });
          bosConfig = loaded?.config ?? null;
        } catch {
          bosConfig = null;
        }
      }
      if (!bosConfig) {
        return {
          status: "fail" as const,
          hostVersion: null,
          hostReachable: false,
          hostReason:
            "Failed to resolve config (authored config invalid and no generated config under .bos/)",
          remotes: [],
        };
      }

      const report = await checkFederationCompat(bosConfig, {
        timeoutMs: input.timeoutMs,
      });
      return {
        status: report.ok ? ("ok" as const) : ("fail" as const),
        hostVersion: report.hostVersion,
        hostReachable: report.hostReachable,
        hostReason: report.hostReason,
        remotes: report.remotes,
      };
    }),

    dbStudio: builder.dbStudio.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const configPath = findConfigPath();
      if (!configPath) {
        return {
          status: "error" as const,
          plugin: input.plugin,
          source: "remote" as const,
          section: "",
          error: "No authored config (bos.app.ts or bos.config.json) found",
        };
      }

      try {
        const binding = await Effect.runPromise(deps.databaseBindings.forPluginKey(input.plugin));
        await Effect.runPromise(deps.drizzleKit.studio(binding));

        return {
          status: "success" as const,
          plugin: binding.key,
          source: binding.source,
          section: binding.section,
          databaseSecret: binding.identity.secretName,
          databaseUrl: binding.url,
          workspaceDir: binding.identity.workspaceDir,
        };
      } catch (error) {
        return {
          status: "error" as const,
          plugin: input.plugin,
          source: "remote" as const,
          section: "",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    dbDoctor: builder.dbDoctor.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            plugin: input.plugin,
            slug: "",
            journalTable: "",
            journalSchema: "",
            diagnosis: "error",
            localMigrationCount: 0,
            appliedHashCount: 0,
            expectedTables: [],
            missingTables: [],
            error: "No authored config (bos.app.ts or bos.config.json) found",
          };
        }

        const binding = await Effect.runPromise(deps.databaseBindings.forPluginKey(input.plugin));

        const { diagnosePlugin } = await import("./cli/db-doctor");
        const report = await diagnosePlugin(binding);

        return {
          status: "success" as const,
          ...report,
        };
      } catch (error) {
        return {
          status: "error" as const,
          plugin: input.plugin,
          slug: "",
          journalTable: "",
          journalSchema: "",
          diagnosis: "error",
          localMigrationCount: 0,
          appliedHashCount: 0,
          expectedTables: [],
          missingTables: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    dbRepair: builder.dbRepair.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            message: "No authored config (bos.app.ts or bos.config.json) found",
            diagnosis: null,
            error: "No config",
          };
        }

        const binding = await Effect.runPromise(deps.databaseBindings.forPluginKey(input.plugin));

        const { repairPlugin } = await import("./cli/db-repair");
        const result = await repairPlugin(binding, input.mode ?? "history-reset", deps.drizzleKit);

        return {
          ...result,
          error: result.status === "error" ? result.message : undefined,
        };
      } catch (error) {
        return {
          status: "error" as const,
          message: error instanceof Error ? error.message : "Unknown error",
          diagnosis: null,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    status: builder.status.handler(async () => {
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            packages: [],
            envFile: "missing" as const,
            error: "No authored config (bos.app.ts or bos.config.json) found",
          };
        }

        const projectDir = resolve(dirname(configPath));
        return await getStatus(projectDir);
      } catch (error) {
        return {
          status: "error" as const,
          packages: [],
          envFile: "missing" as const,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    logs: builder.logs.handler(async ({ input }) => {
      try {
        const configDir = getProjectRoot();
        const text = await readDevLatestLog(configDir, { tail: input.tail });
        const service = input.service;
        const lines = text
          .split("\n")
          .filter((line) => line.length > 0)
          .filter((line) => {
            if (!service) return true;
            const match = /\] \[([^\]]+)\] \[(?:OUT|ERR)\] /.exec(line);
            return match?.[1] === service || match?.[1] === `plugin:${service}`;
          });
        return {
          logFile: resolveDevLatestFile(configDir),
          lines,
        };
      } catch (error) {
        return {
          logFile: "unknown",
          lines: [
            error instanceof Error
              ? `Failed to read logs: ${error.message}`
              : "Failed to read logs",
          ],
        };
      }
    }),

    ps: builder.ps.handler(async () => {
      try {
        const entries = await Effect.runPromise(pruneDeadEffect(readRegistry()));
        return {
          status: "ok" as const,
          entries,
        };
      } catch (error) {
        return {
          status: "error" as const,
          entries: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    kill: builder.kill.handler(async ({ input }) => {
      try {
        const configPath = findConfigPath();
        const targetConfigDir = input.all
          ? undefined
          : (input.configDir ?? (configPath ? resolve(dirname(configPath)) : undefined));

        const targets = targetConfigDir
          ? readRegistry().filter((entry) => entry.configDir === targetConfigDir)
          : readRegistry();

        const killed: Array<{ pid: number; configDir: string }> = [];
        const skipped: Array<{ pid: number; reason: string }> = [];

        for (const entry of targets) {
          const wasAlive = isPidAlive(entry.pid);
          if (wasAlive) {
            await Effect.runPromise(
              killProcessGroupEscalating(entry.pid, {
                terminateMs: 5000,
                signal: input.signal === "SIGKILL" ? "SIGKILL" : "SIGTERM",
              }),
            );
          }

          const reapedChildren: number[] = [];
          for (const childPid of entry.childPids ?? []) {
            if (isPidAlive(childPid)) {
              reapGroup(childPid);
              reapedChildren.push(childPid);
            }
          }

          const ports = Object.values(entry.ports ?? {}).filter(
            (port) => Number.isFinite(port) && port > 0,
          );
          const stillBound: number[] = [];
          for (const port of ports) {
            let bindable = false;
            for (let attempt = 0; attempt < 4; attempt++) {
              bindable = await Effect.runPromise(probePortBindable(port));
              if (bindable) break;
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            if (!bindable) stillBound.push(port);
          }

          if (stillBound.length > 0) {
            const owner = await Effect.runPromise(ownerOfPort(stillBound[0]));
            skipped.push({
              pid: entry.pid,
              reason: `ports still bound after kill: ${stillBound.join(", ")}${
                owner ? ` — held by pid ${owner.pid} (${owner.command})` : " — owner unknown"
              }`,
            });
            continue;
          }

          unregisterPid(entry.pid);
          killed.push({ pid: entry.pid, configDir: entry.configDir });
          if (!wasAlive && reapedChildren.length > 0) {
            skipped.push({
              pid: entry.pid,
              reason: `process already exited; reaped orphaned children ${reapedChildren.join(", ")}`,
            });
          }
        }

        return {
          status: "killed" as const,
          killed,
          skipped,
        };
      } catch (error) {
        return {
          status: "error" as const,
          killed: [],
          skipped: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    infraExport: builder.infraExport.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const configDir = input.configDir ?? deps.configDir;
      const ci = deps.runtimeConfig ? buildCiInfraPlan(deps.runtimeConfig) : null;
      if (!ci) {
        const refreshed = await loadResolvedConfig({ cwd: configDir });
        if (!refreshed?.runtime) {
          throw new Error("No resolved runtime config available for infra export");
        }
        deps.runtimeConfig = refreshed.runtime;
        return buildCiInfraPlan(refreshed.runtime);
      }
      const result: CiInfraPlan & { account: string; gateway: string } = {
        ...ci,
        account: deps.bosConfig?.account ?? ci.account,
        gateway: ci.gateway ?? deps.bosConfig?.domain ?? deps.bosConfig?.account ?? ci.account,
      };
      return result;
    }),
  }),
});

function computeAllowedWorkspaces(overrides: string[], plugins?: string[]): string[] {
  const workspaces: string[] = [];
  for (const section of overrides) {
    if (section === "host") workspaces.push("host");
    if (section === "ui") workspaces.push("ui");
    if (section === "api") workspaces.push("api");
  }
  if (plugins && plugins.length > 0) {
    workspaces.push("plugins/*");
  }
  return workspaces;
}
