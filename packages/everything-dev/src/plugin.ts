import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { Effect } from "effect";
import {
  buildRuntimeConfig,
  type DevPortOptions,
  detectLocalPackages,
  PortAllocatorLive,
  prepareDevelopmentRuntimeConfig,
} from "./app";
import {
  buildEveryPluginQuietly,
  buildEverythingDevQuietly,
  buildWorkspaceTargets,
  fileExists,
  getPluginRef,
  readJsonFile,
  selectWorkspaceTargets,
} from "./build";
import {
  ensureEnvFile,
  loadPortState,
  loadProjectEnv,
  savePortState,
  syncGeneratedInfra,
  writeGeneratedInfra,
} from "./cli/infra";
import {
  buildInitPatterns,
  buildPluginRouteExclusions,
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
import { getStatus } from "./cli/status";
import { syncTemplate } from "./cli/sync";
import { upgradeTemplate } from "./cli/upgrade";
import { generateCodeArtifacts } from "./code-artifacts";
import {
  buildRuntimePluginsForConfig,
  drainConfigWarnings,
  findConfigPath,
  getHostDevelopmentPort,
  getProjectRoot,
  loadLocalConfig,
  loadResolvedConfig,
  resolveConfigComposableEntries,
  resumeWarnings,
  suppressWarnings,
} from "./config";
import {
  type BosConfigResult,
  bosContract,
  type OverrideSection,
  type PhaseTiming,
  type PluginListResult,
} from "./contract";
import {
  buildRegistryConfigUrl,
  fetchBosConfigFromFastKv,
  fetchRemotePluginManifest,
  getRegistryNamespaceForAccount,
  type PluginManifest,
  parseBosUrl,
} from "./fastkv";
import { computeSriHashForUrl, parseDeployLines } from "./integrity";
import { type BosEnv, mergeBosConfigWithExtends, resolveExtendsRef } from "./merge";
import { addFunctionCallAccessKey, ensureNearCli } from "./near-cli";
import { getNetworkIdForAccount } from "./network";
import { pruneDeadEffect, readRegistry, unregisterPid } from "./process-registry";
import { extractPublishedUrl, publishToFastKv } from "./publish";
import { createPlugin, z } from "./sdk";
import {
  type AppOrchestrator,
  buildDescription,
  buildServiceDescriptorMap,
  type ServiceDescriptor,
} from "./service-descriptor";
import { syncResolvedSharedDeps } from "./shared-deps";
import type { BosConfig, BosConfigInput, ExtendsConfig, RuntimeConfig, SourceMode } from "./types";
import { BosConfigSchema } from "./types";
import { run } from "./utils/run";
import { saveBosConfig } from "./utils/save-config";
import { colors } from "./utils/theme";

export interface DevSessionData {
  orchestrator: AppOrchestrator;
  services: Map<string, ServiceDescriptor>;
  runtimeConfig: RuntimeConfig;
}

export interface StartSummary {
  configSource: string;
  configSourceHttp?: string;
  account: string;
  domain?: string;
  modules: { host?: string; ui?: string; api?: string; auth?: string };
  warnings: string[];
}

export type ProgressEvent = {
  phase: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  message?: string;
};

export const pluginEvents = new EventEmitter();

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

async function timePhase<T>(
  timings: PhaseTiming[],
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  pluginEvents.emit("progress", { phase: name, status: "running" } satisfies ProgressEvent);
  const startedAt = Date.now();
  try {
    const result = await fn();
    timings.push({ name, durationMs: Date.now() - startedAt });
    pluginEvents.emit("progress", {
      phase: name,
      status: "done",
      durationMs: Date.now() - startedAt,
    } satisfies ProgressEvent);
    return result;
  } catch (error) {
    pluginEvents.emit("progress", {
      phase: name,
      status: "error",
      durationMs: Date.now() - startedAt,
    } satisfies ProgressEvent);
    throw error;
  }
}

const PUBLISH_FUNCTION_NAMES = ["__fastdata_kv"];

type BosDeps = {
  bosConfig: BosConfig | null;
  runtimeConfig: RuntimeConfig | null;
  configDir: string;
};

type PluginAttachmentConfig = NonNullable<BosConfig["plugins"]>[string];

function parseSourceMode(value: string | undefined, defaultValue: SourceMode): SourceMode {
  if (value === "local" || value === "remote") return value;
  return defaultValue;
}

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

function isValidProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveProxyUrl(bosConfig: BosConfig | null): string | null {
  if (!bosConfig) return null;
  const apiConfig = bosConfig.app.api;
  if (!apiConfig) return null;
  if (apiConfig.proxy && isValidProxyUrl(apiConfig.proxy)) return apiConfig.proxy;
  if (apiConfig.production && isValidProxyUrl(apiConfig.production)) return apiConfig.production;
  return null;
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
): Promise<BosConfig> {
  const selfRef = `bos://${accountId}/${gatewayId}`;
  if (visited.has(selfRef)) {
    throw new Error(`Circular extends detected: ${selfRef}`);
  }

  const nextVisited = new Set(visited);
  nextVisited.add(selfRef);

  const config = await fetchBosConfigFromFastKv<BosConfigInput>(selfRef);
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
    );
    merged = mergeBosConfigWithExtends(parentResolved as BosConfigInput, config);
  }

  return resolveConfigComposableEntries(BosConfigSchema.parse(merged), process.cwd(), "production");
}

async function fetchPublishedConfig(
  accountId: string,
  gatewayId: string,
): Promise<BosConfig | null> {
  try {
    return await resolveRemoteConfigChain(accountId, gatewayId, new Set());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No config found")) {
      return null;
    }
    throw error;
  }
}

export default createPlugin({
  variables: z.object({
    configPath: z.string().optional(),
  }),
  secrets: z.object({}),
  contract: bosContract,
  initialize: (config) =>
    Effect.promise(async () => {
      const configResult = await loadResolvedConfig({ path: config.variables.configPath });
      return {
        bosConfig: configResult?.config ?? null,
        runtimeConfig: configResult?.runtime ?? null,
        configDir: getProjectRoot(),
      } satisfies BosDeps;
    }),
  shutdown: () => Effect.void,
  createRouter: (deps, builder) => ({
    config: builder.config.handler(async ({ input }) => {
      if (input.full) {
        return buildConfigResult(deps.bosConfig, true);
      }

      const localConfig = await loadLocalConfig({ cwd: deps.configDir });
      return buildConfigResult(localConfig?.config ?? null, false);
    }),

    pluginAdd: builder.pluginAdd.handler(async ({ input }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          key: "",
          error: "No bos.config.json found",
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
      const nextPlugins = { ...(deps.bosConfig.plugins ?? {}) };

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

    pluginRemove: builder.pluginRemove.handler(async ({ input }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          key: input.key,
          error: "No bos.config.json found",
        };
      }

      if (!deps.bosConfig.plugins?.[input.key]) {
        return {
          status: "error" as const,
          key: input.key,
          error: `Plugin '${input.key}' is not configured`,
        };
      }

      const nextPlugins = { ...(deps.bosConfig.plugins ?? {}) };
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

    pluginList: builder.pluginList.handler(async () => {
      const plugins: PluginListResult["plugins"] = listPluginAttachments(deps.bosConfig);
      return {
        status: "listed" as const,
        plugins,
      };
    }),

    pluginPublish: builder.pluginPublish.handler(async ({ input }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          key: input.key,
          error: "No bos.config.json found",
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
      const script = pkgJson.scripts?.deploy ? "deploy" : "build";

      const { stdout, stderr, exitCode } = (await run("bun", ["run", script], {
        cwd: localPath,
        capture: true,
      })) as { stdout: string; stderr: string; exitCode: number };

      if (exitCode !== 0) {
        if (stdout.trim()) process.stdout.write(stdout);
        if (stderr.trim()) process.stderr.write(stderr);
        return {
          status: "error" as const,
          key: input.key,
          error: `Publish failed with exit code ${exitCode}`,
        };
      }

      if (stdout.trim()) process.stdout.write(stdout);
      if (stderr.trim()) process.stderr.write(stderr);

      const output = `${stdout}\n${stderr}`;
      const deployEntries = parseDeployLines(output);
      const deployEntry = deployEntries.find(
        (e) => e.urlField === `plugins.${input.key}.production`,
      );

      let publishedUrl: string | undefined;
      let integrity: string | undefined;
      if (deployEntry) {
        publishedUrl = deployEntry.url;
        integrity = deployEntry.integrity;
      } else {
        publishedUrl = extractPublishedUrl(output) ?? undefined;
        integrity = publishedUrl
          ? ((await computeSriHashForUrl(publishedUrl)) ?? undefined)
          : undefined;
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
        const rootConfigPath = join(deps.configDir, "bos.config.json");
        try {
          const rootConfig = JSON.parse(readFileSync(rootConfigPath, "utf-8")) as Record<
            string,
            unknown
          >;
          if (!rootConfig.plugins || typeof rootConfig.plugins !== "object") {
            rootConfig.plugins = {};
          }
          const plugins = rootConfig.plugins as Record<string, unknown>;
          if (!plugins[input.key] || typeof plugins[input.key] !== "object") {
            plugins[input.key] = {};
          }
          const entry = plugins[input.key] as Record<string, unknown>;
          entry.production = publishedUrl;
          if (integrity) {
            entry.integrity = integrity;
          } else {
            delete entry.integrity;
          }
          writeFileSync(rootConfigPath, `${JSON.stringify(rootConfig, null, 2)}\n`);
          console.log(`   ✅ Updated bos.config.json: plugins.${input.key}.production`);
        } catch (err) {
          console.error(
            `   ❌ Failed to update bos.config.json:`,
            err instanceof Error ? err.message : err,
          );
        }

        await generateCodeArtifacts(deps.configDir, deps.bosConfig);
      }

      return {
        status: "published" as const,
        key: input.key,
        path: localPath,
        script,
        production: publishedUrl ?? attachmentRef?.production,
        integrity: integrity ?? undefined,
        version: version ?? undefined,
      };
    }),

    dev: builder.dev.handler(async ({ input }) => {
      const devTimings: PhaseTiming[] = [];

      ensureEnvFile(deps.configDir);
      loadProjectEnv(deps.configDir);

      const localPackages = detectLocalPackages(
        deps.bosConfig ?? undefined,
        deps.runtimeConfig ?? undefined,
      );

      const hostSource: SourceMode = localPackages.includes("host")
        ? parseSourceMode(input.host, "local")
        : "remote";
      const uiSource: SourceMode = localPackages.includes("ui")
        ? parseSourceMode(input.ui, "local")
        : "remote";
      const apiSource: SourceMode = localPackages.includes("api")
        ? parseSourceMode(input.api, "local")
        : "remote";
      const authSource: SourceMode = localPackages.includes("auth")
        ? parseSourceMode(input.auth, "local")
        : "remote";
      const ssr = input.ssr ?? false;
      const proxy = input.proxy ?? false;

      const sharedSync = await timePhase(devTimings, "shared deps", () =>
        syncResolvedSharedDeps({
          configDir: deps.configDir,
          hostMode: hostSource,
          bosConfig: deps.bosConfig ?? undefined,
          extendsChain: [],
        }),
      );
      let configMayHaveChanged = false;
      if (sharedSync.catalogChanged) {
        await timePhase(devTimings, "install", () =>
          run("bun", ["install"], { cwd: deps.configDir }),
        );
        configMayHaveChanged = true;
      }
      const shouldBuildPlugin =
        (apiSource === "local" && !proxy) || localPackages.some((pkg) => pkg.startsWith("plugin:"));

      await timePhase(devTimings, "build", async () => {
        const buildTasks: Promise<void>[] = [buildEverythingDevQuietly(deps.configDir)];
        if (shouldBuildPlugin) {
          buildTasks.push(buildEveryPluginQuietly(deps.configDir));
        }
        await Promise.all(buildTasks);
      });

      let devExtendsChain: string[] | undefined;
      if (configMayHaveChanged || input.remotePlugins?.length) {
        const refreshed = await timePhase(devTimings, "resolve config", () =>
          loadResolvedConfig({
            cwd: deps.configDir,
            remotePlugins: input.remotePlugins,
          }),
        );
        deps.bosConfig = refreshed?.config ?? deps.bosConfig;
        deps.runtimeConfig = refreshed?.runtime ?? deps.runtimeConfig;
        devExtendsChain = refreshed?.source.extended;
      }

      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          description: "No bos.config.json found",
          processes: [],
          timings: devTimings,
        };
      }

      if (proxy && !resolveProxyUrl(deps.bosConfig)) {
        return {
          status: "error" as const,
          description: "No valid proxy URL configured in bos.config.json",
          processes: [],
          timings: devTimings,
        };
      }

      const persistedPorts = loadPortState(deps.configDir).devPorts;
      const hostPreferredPort =
        input.port ??
        persistedPorts?.host ??
        getHostDevelopmentPort(deps.bosConfig.app.host.development);
      suppressWarnings();
      const developmentRuntime = buildRuntimeConfig(deps.bosConfig, {
        uiSource,
        apiSource,
        authSource,
        hostSource,
        env: "development",
        plugins: deps.runtimeConfig?.plugins,
      });
      drainConfigWarnings();
      resumeWarnings();
      const portOptions: DevPortOptions = {
        hostPort: hostPreferredPort,
        apiPort: input.apiPort ?? persistedPorts?.api,
        uiPort: input.uiPort ?? persistedPorts?.ui,
        authPort: input.authPort ?? persistedPorts?.auth,
        pluginPortStart: input.pluginPortStart ?? persistedPorts?.pluginPortStart,
        ssr,
      };
      const { runtimeConfig, devPorts } = await timePhase(devTimings, "ports", () =>
        Effect.runPromise(
          prepareDevelopmentRuntimeConfig(developmentRuntime, portOptions).pipe(
            Effect.provide(PortAllocatorLive),
          ),
        ),
      );

      const priorState = loadPortState(deps.configDir);
      savePortState(deps.configDir, {
        postgresPorts: priorState.postgresPorts,
        redisPorts: priorState.redisPorts,
        devPorts,
      });

      syncGeneratedInfra(deps.configDir, runtimeConfig);
      ensureEnvFile(deps.configDir);
      loadProjectEnv(deps.configDir);

      await timePhase(devTimings, "generate artifacts", () =>
        generateCodeArtifacts(deps.configDir, deps.bosConfig!, {
          env: "development",
          extendsChain: devExtendsChain,
          runtimeConfig,
        }),
      );

      const services = buildServiceDescriptorMap(runtimeConfig, { ssr, proxy });
      const packages = [...services.keys()];
      if (process.env.DEBUG === "true" || process.env.DEBUG === "1") {
        console.error("[DEBUG dev] services keys:", packages.join(", "));
        console.error(
          "[DEBUG dev] services sources:",
          packages.map((k) => `${k}=${services.get(k)?.source ?? "?"}`).join(", "),
        );
        console.error(
          "[DEBUG dev] runtimeConfig.plugins keys:",
          Object.keys(runtimeConfig.plugins ?? {}).join(", "),
        );
        console.error(
          "[DEBUG dev] runtimeConfig.plugins sources:",
          Object.entries(runtimeConfig.plugins ?? {})
            .map(([k, v]) => `${k}=${v.source}`)
            .join(", "),
        );
      }
      const displayEnv: Record<string, string> = {};
      const apiDescriptor = services.get("api");
      if (apiDescriptor?.proxy) {
        const proxyUrl = resolveProxyUrl(deps.bosConfig);
        if (proxyUrl) displayEnv.API_PROXY = proxyUrl;
      }

      const orchestrator: AppOrchestrator = {
        packages,
        env: displayEnv,
        description: buildDescription(services),
        port: runtimeConfig.host.port,
        interactive: input.interactive,
      };

      pendingSession = { orchestrator, services, runtimeConfig };

      return {
        status: "started" as const,
        description: orchestrator.description,
        processes: packages,
        timings: devTimings,
      };
    }),

    start: builder.start.handler(async ({ input }) => {
      ensureEnvFile(deps.configDir);
      loadProjectEnv(deps.configDir);

      pluginEvents.emit("progress", { phase: "config", status: "running" } satisfies ProgressEvent);

      const bosEnv = input.env ?? (process.env.BOS_ENV === "staging" ? "staging" : "production");
      const account = input.account ?? process.env.BOS_ACCOUNT;
      const domain = input.domain ?? process.env.BOS_GATEWAY;

      let config: BosConfig | null = null;
      let remoteConfig: BosConfig | null = null;

      if (account && domain) {
        try {
          remoteConfig = await fetchPublishedConfig(account, domain);
          if (remoteConfig) {
            config = remoteConfig;
          } else {
            return {
              status: "error" as const,
              url: "",
              error: `No config found at bos://${account}/${domain}. Verify the account and gateway are correct and the config has been published.\nExpected URL: ${buildRegistryConfigUrl(account, domain)}`,
            };
          }
        } catch (error) {
          return {
            status: "error" as const,
            url: "",
            error: `Failed to fetch config for bos://${account}/${domain}: ${error instanceof Error ? error.message : "Unknown error"}\nExpected URL: ${buildRegistryConfigUrl(account, domain)}`,
          };
        }
      } else {
        config = deps.bosConfig;
      }

      if (!config) {
        return {
          status: "error" as const,
          url: "",
          error:
            "No configuration found. Provide --account and --gateway flags, or create a local bos.config.json.",
        };
      }

      // Apply runtime overrides from CLI flags / env vars
      if (account) {
        config = { ...config, account };
      }
      if (domain) {
        config = { ...config, domain };
      }

      const port = input.port ?? getHostDevelopmentPort(config.app.host.development);
      const isStaging = bosEnv === "staging";
      const runtimePlugins = await buildRuntimePluginsForConfig(
        config,
        deps.configDir,
        "production",
      );
      suppressWarnings();
      const runtimeConfig = buildRuntimeConfig(config, {
        uiSource: "remote",
        apiSource: "remote",
        authSource: "remote",
        hostSource: "remote",
        env: "production",
        plugins: runtimePlugins,
      });
      drainConfigWarnings();
      resumeWarnings();

      if (isStaging && config.staging?.domain) {
        runtimeConfig.domain = config.staging.domain;
      }

      if (isStaging) {
        runtimeConfig.env = "staging";
      }

      syncGeneratedInfra(deps.configDir, runtimeConfig);
      ensureEnvFile(deps.configDir);
      loadProjectEnv(deps.configDir);

      pluginEvents.emit("progress", {
        phase: "generate artifacts",
        status: "running",
      } satisfies ProgressEvent);
      await generateCodeArtifacts(deps.configDir, config, {
        env: "production",
        runtimeConfig,
      });
      pluginEvents.emit("progress", {
        phase: "generate artifacts",
        status: "done",
      } satisfies ProgressEvent);

      // ── Production Readiness Validation ──
      const productionEnv: Record<string, string> = {};
      const warnings: string[] = [];

      // Default CORS_ORIGIN to the configured domain if not set
      if (!process.env.CORS_ORIGIN && config.domain) {
        const effectiveDomain = isStaging
          ? (config.staging?.domain ?? config.domain)
          : config.domain;
        const defaultOrigin = `https://${effectiveDomain}`;
        productionEnv.CORS_ORIGIN = defaultOrigin;
        warnings.push(`CORS_ORIGIN defaulting to ${defaultOrigin}`);
      }

      // Validate required secrets
      const requiredSecrets = new Set<string>();
      const missingSecrets: string[] = [];

      if (runtimeConfig.host.secrets) {
        for (const s of runtimeConfig.host.secrets) requiredSecrets.add(s);
      }
      if (runtimeConfig.auth?.secrets) {
        for (const s of runtimeConfig.auth.secrets) requiredSecrets.add(s);
      }
      if (runtimeConfig.api?.secrets) {
        for (const s of runtimeConfig.api.secrets) requiredSecrets.add(s);
      }
      for (const plugin of Object.values(runtimeConfig.plugins ?? {})) {
        if (plugin.secrets) {
          for (const s of plugin.secrets) requiredSecrets.add(s);
        }
      }

      for (const secret of requiredSecrets) {
        const value = process.env[secret];
        if (!value || value.length === 0) {
          missingSecrets.push(secret);
        }
      }

      if (missingSecrets.length > 0) {
        warnings.push(`Missing ${missingSecrets.length} secret(s): ${missingSecrets.join(", ")}`);
      }

      const services = buildServiceDescriptorMap(runtimeConfig);

      const stagingEnvVars: Record<string, string> = isStaging
        ? { BOS_GATEWAY: config.staging?.domain ?? config.domain ?? "" }
        : {};

      const configSource = remoteConfig
        ? `bos://${account}/${domain}`
        : (findConfigPath() ?? "bos.config.json");

      const configSourceHttp =
        remoteConfig && account && domain ? buildRegistryConfigUrl(account, domain) : undefined;

      const summary: StartSummary = {
        configSource,
        configSourceHttp,
        account: config.account,
        domain: config.domain ?? undefined,
        modules: {
          host: runtimeConfig.host.remoteUrl ?? runtimeConfig.host.url ?? "local",
          ui: runtimeConfig.ui.url ?? "local",
          api: runtimeConfig.api.url ?? "local",
          auth: runtimeConfig.auth?.url ?? undefined,
        },
        warnings,
      };

      const orchestrator: AppOrchestrator = {
        packages: ["host"],
        env: {
          NODE_ENV: "production",
          ...productionEnv,
          ...stagingEnvVars,
        },
        description: `${isStaging ? "Staging" : "Production"} Mode (${config.account})`,
        port,
        interactive: input.interactive,
        noLogs: true,
      };

      pendingSession = { orchestrator, services, runtimeConfig };
      pendingStartSummary = summary;

      pluginEvents.emit("progress", { phase: "config", status: "done" } satisfies ProgressEvent);

      return {
        status: "running" as const,
        url: `http://localhost:${port}`,
      };
    }),

    build: builder.build.handler(async ({ input }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          built: [],
          skipped: [],
        };
      }

      const buildEnv: BosEnv = input.deploy ? "production" : "development";

      const targets = selectWorkspaceTargets(input.packages, deps.bosConfig);
      if (targets.length === 0) {
        return {
          status: "error" as const,
          built: [],
          skipped: [],
        };
      }

      suppressWarnings();
      const runtimeConfig = buildRuntimeConfig(deps.bosConfig, {
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

    publish: builder.publish.handler(async ({ input }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: "No bos.config.json found",
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

    deploy: builder.deploy.handler(async ({ input }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          registryUrl: "",
          redeployed: false,
          error: "No bos.config.json found",
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

    keyPublish: builder.keyPublish.handler(async ({ input }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          account: "",
          network: "mainnet" as const,
          contract: "",
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          error: "No bos.config.json found",
        };
      }

      const account = deps.bosConfig.account;
      const network = getNetworkIdForAccount(account);
      const contract = getRegistryNamespaceForAccount(account);
      try {
        await Effect.runPromise(ensureNearCli);
        const keyPair = await addFunctionCallAccessKey({
          account,
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          network,
        });

        return {
          status: "published" as const,
          account,
          network,
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
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
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
            `[init] Failed to fetch parent config from ${extendsAccount}/${extendsGateway}: ${e instanceof Error ? e.message : e}`,
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
            }),
          );

          const lockfilePath = join(targetDir, "bun.lock");
          const allowedWorkspaces = computeAllowedWorkspaces(overrides, plugins);
          stripOrphanedWorkspacesFromLockfile(lockfilePath, allowedWorkspaces);
          removeInitLockfile(lockfilePath);

          const initConfig = await timePhase(timings, "resolve config", () =>
            loadResolvedConfig({ cwd: targetDir }),
          );
          if (initConfig?.runtime) {
            await timePhase(timings, "generate env/docker", async () => {
              writeGeneratedInfra(targetDir, initConfig.runtime);
            });
          }
          await timePhase(timings, "create env file", async () => {
            ensureEnvFile(targetDir);
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
            error: "No bos.config.json found in current directory",
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
            error: "No bos.config.json found in current directory",
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
            error: "No bos.config.json found in current directory",
          };
        }

        const projectDir = resolve(dirname(configPath));
        const env =
          input.env ?? (process.env.NODE_ENV === "production" ? "production" : "development");

        const refreshed = await loadResolvedConfig({ cwd: projectDir, env });
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
            fetched.push(`api (${refreshed.runtime.api.url})`);
          } else {
            skipped.push("api (local)");
          }

          if (refreshed.runtime.auth) {
            if (refreshed.runtime.auth.source !== "local") {
              fetched.push(`auth (${refreshed.runtime.auth.url})`);
            } else {
              skipped.push("auth (local)");
            }
          }

          for (const [key, plugin] of pluginEntries) {
            if (plugin.url && plugin.source !== "local") {
              fetched.push(`${key} (${plugin.url})`);
            } else if (plugin.localPath) {
              skipped.push(`${key} (local)`);
            } else {
              skipped.push(`${key} (no URL resolved)`);
            }
          }

          const generated = ["ui/src/lib/api-types.gen.ts", "ui/src/lib/auth-types.gen.ts"];
          if (hasLocalApiWorkspace) {
            generated.push("api/src/lib/plugins-types.gen.ts", "api/src/lib/auth-types.gen.ts");
          }
          if (existsSync(join(projectDir, "host", "src"))) {
            generated.push("host/src/lib/auth-types.gen.ts");
          }

          return {
            status: "success" as const,
            generated,
            fetched,
            skipped,
            failed: [],
            source: refreshed.runtime.api.source,
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

        const contractStatus = artifacts?.contractStatus ?? [];
        const fetched: string[] = [];
        const skipped: string[] = [];
        const failed: string[] = [];
        for (const entry of contractStatus) {
          if (entry.source === "remote") {
            fetched.push(entry.url ? `${entry.key} (${entry.url})` : entry.key);
          } else if (entry.source === "local") {
            skipped.push(`${entry.key} (local)`);
          } else if (entry.source === "skipped") {
            skipped.push(`${entry.key} (no URL resolved)`);
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
          source: refreshed.runtime.api.source,
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

    dbStudio: builder.dbStudio.handler(async ({ input }) => {
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            plugin: input.plugin,
            source: "remote" as const,
            section: "",
            error: "No bos.config.json found in current directory",
          };
        }

        const projectDir = resolve(dirname(configPath));
        loadProjectEnv(projectDir);
        const refreshed = await loadResolvedConfig({ cwd: projectDir });
        if (!refreshed) {
          return {
            status: "error" as const,
            plugin: input.plugin,
            source: "remote" as const,
            section: "",
            error: "Failed to load bos.config.json",
          };
        }

        const { resolvePluginDbInfo } = await import("./cli/db-studio");
        const info = resolvePluginDbInfo(input.plugin, refreshed.runtime, projectDir);

        return {
          status: "success" as const,
          plugin: info.key,
          source: info.source,
          section: info.section,
          databaseSecret: info.databaseSecret,
          databaseUrl: info.databaseUrl,
          workspaceDir: info.workspaceDir,
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

    dbDoctor: builder.dbDoctor.handler(async ({ input }) => {
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
            legacyCount: 0,
            error: "No bos.config.json",
          };
        }

        const projectDir = resolve(dirname(configPath));
        loadProjectEnv(projectDir);
        const refreshed = await loadResolvedConfig({ cwd: projectDir });
        if (!refreshed) {
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
            legacyCount: 0,
            error: "Failed to load config",
          };
        }

        const { resolvePluginDbInfo } = await import("./cli/db-studio");
        const info = resolvePluginDbInfo(input.plugin, refreshed.runtime, projectDir);

        const { diagnosePlugin } = await import("./cli/db-doctor");
        const report = await diagnosePlugin(info);

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
          legacyCount: 0,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    dbRepair: builder.dbRepair.handler(async ({ input }) => {
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            message: "No bos.config.json found",
            diagnosis: null,
            error: "No config",
          };
        }

        const projectDir = resolve(dirname(configPath));
        loadProjectEnv(projectDir);
        const refreshed = await loadResolvedConfig({ cwd: projectDir });
        if (!refreshed) {
          return {
            status: "error" as const,
            message: "Failed to load config",
            diagnosis: null,
            error: "Config load failed",
          };
        }

        const { resolvePluginDbInfo } = await import("./cli/db-studio");
        const info = resolvePluginDbInfo(input.plugin, refreshed.runtime, projectDir);

        const { repairPlugin } = await import("./cli/db-repair");
        const result = await repairPlugin(info, input.mode ?? "history-reset");

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
            error: "No bos.config.json found in current directory",
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
        const entries = await Effect.runPromise(pruneDeadEffect(readRegistry()));
        const configPath = findConfigPath();
        const targetConfigDir = input.all
          ? undefined
          : (input.configDir ?? (configPath ? resolve(dirname(configPath)) : undefined));

        const targets = targetConfigDir
          ? entries.filter((entry) => entry.configDir === targetConfigDir)
          : entries;

        const killed: Array<{ pid: number; configDir: string }> = [];
        const skipped: Array<{ pid: number; reason: string }> = [];

        for (const entry of targets) {
          try {
            process.kill(entry.pid, input.signal === "SIGKILL" ? "SIGKILL" : "SIGTERM");
            killed.push({ pid: entry.pid, configDir: entry.configDir });
            unregisterPid(entry.pid);
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "ESRCH") {
              skipped.push({ pid: entry.pid, reason: "process already exited" });
              unregisterPid(entry.pid);
            } else {
              skipped.push({
                pid: entry.pid,
                reason: (err as Error).message ?? "kill failed",
              });
            }
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
