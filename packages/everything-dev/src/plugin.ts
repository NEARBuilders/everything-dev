import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { Effect } from "effect";
import { type ContractBridgeStatus, syncApiContractBridge } from "./api-contract";
import { buildRuntimeConfig, detectLocalPackages, prepareDevelopmentRuntimeConfig } from "./app";
import {
  ensureEnvFile,
  loadProjectEnv,
  syncGeneratedInfra,
  writeGeneratedInfra,
} from "./cli/infra";
import {
  buildInitPatterns,
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
import {
  buildRuntimePluginsForConfig,
  drainConfigWarnings,
  findConfigPath,
  getHostDevelopmentPort,
  getProjectRoot,
  loadLocalConfig,
  loadResolvedConfig,
  resolveConfigComposableEntries,
  resolveLocalDevelopmentPath,
  resumeWarnings,
  suppressWarnings,
  writeResolvedConfig,
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
  buildRegistryConfigUrlForNetwork,
  fetchBosConfigFromFastKv,
  fetchRemotePluginManifest,
  getRegistryNamespaceForAccount,
  getRegistryNamespaceForNetwork,
  type PluginManifest,
  parseBosUrl,
} from "./fastkv";
import { computeSriHashForUrl } from "./integrity";
import { type BosEnv, mergeBosConfigWithExtends, resolveExtendsRef } from "./merge";
import {
  addFunctionCallAccessKey,
  ensureNearCli,
  executeTransaction,
  resolveNearSigningMode,
} from "./near-cli";
import { getNetworkIdForAccount } from "./network";
import { createPlugin, z } from "./sdk";
import {
  type AppOrchestrator,
  buildDescription,
  buildServiceDescriptorMap,
  type ServiceDescriptor,
} from "./service-descriptor";
import { syncResolvedSharedDeps } from "./shared-deps";
import { writePluginSidebarGen } from "./sidebar";
import type {
  BosConfig,
  BosConfigInput,
  BosPluginRef,
  ExtendsConfig,
  RuntimeConfig,
  SourceMode,
} from "./types";
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

const buildCommands: Record<string, { cmd: string; args: string[] }> = {
  host: { cmd: "bun", args: ["run", "build"] },
  ui: { cmd: "bun", args: ["run", "build"] },
  api: { cmd: "bun", args: ["run", "build"] },
};

const PUBLISH_FUNCTION_NAMES = ["__fastdata_kv"];

type BosDeps = {
  bosConfig: BosConfig | null;
  runtimeConfig: RuntimeConfig | null;
  configDir: string;
};

type PluginAttachmentConfig = NonNullable<BosConfig["plugins"]>[string];

function getPluginRef(entry: string | BosPluginRef | undefined | null): BosPluginRef | null {
  if (!entry || typeof entry === "string") return null;
  return entry;
}

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

type WorkspaceTarget = {
  key: string;
  kind: "app" | "plugin";
  path: string;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function resolveWorkspaceTarget(
  key: string,
  bosConfig: BosConfig | null,
  runtimeConfig: RuntimeConfig | null,
  configDir: string,
): WorkspaceTarget | null {
  if (bosConfig?.app && key in bosConfig.app) {
    const appEntry = (bosConfig.app as Record<string, { development?: string }>)[key];
    const devPath = resolveLocalDevelopmentPath(appEntry?.development, configDir);
    if (devPath) {
      return {
        key,
        kind: "app",
        path: devPath,
      };
    }
    return {
      key,
      kind: "app",
      path: `${configDir}/${key}`,
    };
  }

  const runtimePlugin = runtimeConfig?.plugins?.[key];
  const pluginPath =
    runtimePlugin?.localPath ??
    resolveLocalDevelopmentPath(getPluginRef(bosConfig?.plugins?.[key])?.development, configDir);
  if (pluginPath) {
    return {
      key,
      kind: "plugin",
      path: pluginPath,
    };
  }

  return null;
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

interface GeneratedArtifacts {
  sidebarPath: string;
  resolvedConfigPath?: string;
  contractBridgePath: string;
}

async function generateCodeArtifacts(
  configDir: string,
  config: BosConfig,
  opts?: {
    env?: BosEnv;
    extendsChain?: string[];
    runtimeConfig?: RuntimeConfig;
  },
): Promise<(GeneratedArtifacts & { contractStatus: ContractBridgeStatus[] }) | null> {
  if (opts?.env) {
    writeResolvedConfig(configDir, config, opts.env, opts.extendsChain);
  }

  const runtimeConfig =
    opts?.runtimeConfig ?? (await loadResolvedConfig({ cwd: configDir }))?.runtime;
  if (!runtimeConfig) return null;

  writePluginSidebarGen(configDir, runtimeConfig);

  const bridge = await syncApiContractBridge({
    configDir,
    runtimeConfig,
    apiBaseUrl: runtimeConfig.api.url,
  });

  return {
    sidebarPath: join(configDir, "ui/src/lib/plugin-sidebar.gen.ts"),
    resolvedConfigPath: opts?.env ? join(configDir, ".bos/bos.resolved-config.json") : undefined,
    contractBridgePath: bridge.bridgePath,
    contractStatus: bridge.status,
  };
}

function extractPublishedUrl(output: string): string | null {
  const match = output.match(/https?:\/\/[^\s"'<>]+/g);
  if (!match || match.length === 0) return null;
  return match[match.length - 1] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForPublishedConfig(opts: {
  account: string;
  gateway: string;
  publishConfig: BosConfigInput;
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

async function buildEveryPluginQuietly(cwd: string) {
  const packageDir = `${cwd}/packages/every-plugin`;
  const packageExists = await fileExists(`${packageDir}/package.json`);
  if (!packageExists) {
    return;
  }

  const distPath = `${cwd}/packages/every-plugin/dist/build/rspack/plugin.mjs`;
  const distExists = await fileExists(distPath);

  if (distExists) {
    return;
  }

  const result = (await run("bun", ["run", "--cwd", "packages/every-plugin", "build"], {
    cwd,
    capture: true,
  })) as { stdout: string; stderr: string; exitCode: number };

  if (result.exitCode === 0) {
    console.log("[build:ssr] build succeeded");
    return;
  }

  if (result.stdout.trim()) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }

  throw new Error(
    `bun run --cwd packages/every-plugin build failed with exit code ${result.exitCode}`,
  );
}

async function buildEverythingDevQuietly(cwd: string) {
  const packageDir = `${cwd}/packages/everything-dev`;
  const packageExists = await fileExists(`${packageDir}/package.json`);
  if (!packageExists) {
    return;
  }

  const distPath = `${cwd}/packages/everything-dev/dist/index.mjs`;
  const distExists = await fileExists(distPath);

  if (distExists) {
    return;
  }

  const result = (await run("bun", ["run", "--cwd", "packages/everything-dev", "build"], {
    cwd,
    capture: true,
  })) as { stdout: string; stderr: string; exitCode: number };

  if (result.exitCode === 0) {
    console.log("[everything-dev] build succeeded");
    return;
  }

  if (result.stdout.trim()) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }

  throw new Error(
    `bun run --cwd packages/everything-dev build failed with exit code ${result.exitCode}`,
  );
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
    merged = mergeBosConfigWithExtends(parentResolved, config);
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

function selectWorkspaceTargets(packages: string, bosConfig: BosConfig | null): string[] {
  const allPackages = [
    ...Object.keys(bosConfig?.app ?? {}),
    ...Object.keys(bosConfig?.plugins ?? {}),
  ];
  if (packages === "all") {
    return allPackages;
  }

  return packages
    .split(",")
    .map((pkg) => pkg.trim())
    .filter((pkg) => allPackages.includes(pkg));
}

async function buildWorkspaceTargets(opts: {
  configDir: string;
  bosConfig: BosConfig | null;
  runtimeConfig: RuntimeConfig | null;
  targets: string[];
  deploy: boolean;
}): Promise<{ built: string[]; skipped: string[] }> {
  const existing: WorkspaceTarget[] = [];
  const skipped: string[] = [];

  for (const target of opts.targets) {
    const resolved = resolveWorkspaceTarget(
      target,
      opts.bosConfig,
      opts.runtimeConfig,
      opts.configDir,
    );
    if (!resolved) {
      skipped.push(target);
      continue;
    }

    const exists = await fileExists(`${resolved.path}/package.json`);
    if (exists) existing.push(resolved);
    else skipped.push(target);
  }

  if (existing.length === 0) {
    return { built: [], skipped };
  }

  const sharedSync = await syncResolvedSharedDeps({
    configDir: opts.configDir,
    hostMode: "local",
    bosConfig: opts.bosConfig ?? undefined,
    extendsChain: [],
  });
  if (sharedSync.catalogChanged) {
    await run("bun", ["install"], { cwd: opts.configDir });
  }

  if (existing.some((entry) => entry.key === "api")) {
    await buildEveryPluginQuietly(opts.configDir);
  }

  await buildEverythingDevQuietly(opts.configDir);

  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: opts.deploy ? "production" : "development",
  };
  if (opts.deploy) {
    env.DEPLOY = "true";
  } else {
    delete env.DEPLOY;
  }

  const orderedExisting = opts.deploy
    ? [
        ...existing.filter((entry) => entry.kind === "app" && entry.key !== "host"),
        ...existing.filter((entry) => entry.kind === "plugin"),
        ...existing.filter((entry) => entry.kind === "app" && entry.key === "host"),
      ]
    : existing;
  const built: string[] = [];

  for (const resolved of orderedExisting) {
    const pkgJson = await readJsonFile<{
      scripts?: Record<string, string>;
    }>(`${resolved.path}/package.json`);
    const shouldDeployScript = opts.deploy && pkgJson.scripts?.deploy;
    const buildConfig = shouldDeployScript
      ? { cmd: "bun", args: ["run", "deploy"] }
      : (buildCommands[resolved.key] ?? { cmd: "bun", args: ["run", "build"] });

    await run(buildConfig.cmd, buildConfig.args, {
      cwd: resolved.path,
      env,
    });
    built.push(resolved.key);
  }

  return { built, skipped };
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

      let publishedUrl = extractPublishedUrl(`${stdout}\n${stderr}`);

      let manifest: PluginManifest | null = null;
      if (publishedUrl) {
        manifest = await fetchRemotePluginManifest(publishedUrl);
      } else if (attachmentRef?.production) {
        manifest = await fetchRemotePluginManifest(attachmentRef.production);
        if (manifest) {
          publishedUrl = attachmentRef.production;
        }
      }

      const integrity = publishedUrl ? await computeSriHashForUrl(publishedUrl) : null;
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
      ensureEnvFile(deps.configDir);
      loadProjectEnv(deps.configDir);

      pluginEvents.emit("progress", { phase: "config", status: "running" } satisfies ProgressEvent);

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

      const sharedSync = await syncResolvedSharedDeps({
        configDir: deps.configDir,
        hostMode: hostSource,
        bosConfig: deps.bosConfig ?? undefined,
        extendsChain: [],
      });
      if (sharedSync.catalogChanged) {
        pluginEvents.emit("progress", {
          phase: "install",
          status: "running",
        } satisfies ProgressEvent);
        await run("bun", ["install"], { cwd: deps.configDir });
        pluginEvents.emit("progress", { phase: "install", status: "done" } satisfies ProgressEvent);
      }
      if (
        (apiSource === "local" && !proxy) ||
        localPackages.some((pkg) => pkg.startsWith("plugin:"))
      ) {
        pluginEvents.emit("progress", {
          phase: "build plugin",
          status: "running",
        } satisfies ProgressEvent);
        await buildEveryPluginQuietly(deps.configDir);
        pluginEvents.emit("progress", {
          phase: "build plugin",
          status: "done",
        } satisfies ProgressEvent);
      }

      pluginEvents.emit("progress", { phase: "build", status: "running" } satisfies ProgressEvent);
      await buildEverythingDevQuietly(deps.configDir);
      pluginEvents.emit("progress", { phase: "build", status: "done" } satisfies ProgressEvent);

      pluginEvents.emit("progress", { phase: "config", status: "done" } satisfies ProgressEvent);

      const refreshed = await loadResolvedConfig({
        cwd: deps.configDir,
        remotePlugins: input.remotePlugins,
      });
      deps.bosConfig = refreshed?.config ?? deps.bosConfig;
      deps.runtimeConfig = refreshed?.runtime ?? deps.runtimeConfig;

      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          description: "No bos.config.json found",
          processes: [],
        };
      }

      if (proxy && !resolveProxyUrl(deps.bosConfig)) {
        return {
          status: "error" as const,
          description: "No valid proxy URL configured in bos.config.json",
          processes: [],
        };
      }

      const hostPort = input.port ?? getHostDevelopmentPort(deps.bosConfig.app.host.development);
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
      const runtimeConfig = await prepareDevelopmentRuntimeConfig(developmentRuntime, {
        hostPort,
        ssr,
      });

      syncGeneratedInfra(deps.configDir, runtimeConfig);
      if (!existsSync(join(deps.configDir, ".env"))) {
        ensureEnvFile(deps.configDir);
        loadProjectEnv(deps.configDir);
      }

      await generateCodeArtifacts(deps.configDir, deps.bosConfig, {
        env: "development",
        extendsChain: refreshed?.source.extended,
        runtimeConfig,
      });

      const services = buildServiceDescriptorMap(runtimeConfig, { ssr, proxy });
      const packages = [...services.keys()];
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
      if (!existsSync(join(deps.configDir, ".env"))) {
        ensureEnvFile(deps.configDir);
        loadProjectEnv(deps.configDir);
      }

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
        } catch {}

        overrides = overrides?.length ? overrides : (["ui", "api"] as OverrideSection[]);
        if (overrides.includes("plugins") && plugins === undefined) {
          plugins = parentPluginKeys;
        }
        plugins = plugins ?? [];

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
            const patterns = buildInitPatterns(overrides, plugins);

            filesCopied = await timePhase(timings, "copy files", () =>
              copyFilteredFiles(sourceDir, targetDir, patterns, {
                overrides,
                plugins,
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
        const generated = ["ui/src/lib/plugin-sidebar.gen.ts", "ui/src/lib/api-types.gen.ts"];
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
  }),
});

interface PublishToFastKvInput {
  bosConfig: BosConfig;
  runtimeConfig: RuntimeConfig | null;
  configDir: string;
  env: "production" | "staging";
  build: boolean;
  dryRun: boolean;
  packages: string;
  network?: "mainnet" | "testnet";
  privateKey?: string;
}

interface PublishToFastKvResult {
  status: "published" | "error" | "dry-run";
  registryUrl: string;
  txHash?: string;
  built?: string[];
  skipped?: string[];
  error?: string;
  publishConfig?: BosConfigInput;
}

async function publishToFastKv(input: PublishToFastKvInput): Promise<PublishToFastKvResult> {
  const { env, dryRun, configDir } = input;
  let bosConfig = input.bosConfig;
  const runtimeConfig = input.runtimeConfig;

  const isStaging = env === "staging";
  const account = bosConfig.account;
  const gateway = isStaging ? (bosConfig.staging?.domain ?? bosConfig.domain) : bosConfig.domain;
  if (!gateway) {
    return {
      status: "error",
      registryUrl: "",
      error: "bos.config.json must define domain to publish",
    };
  }

  const network = input.network ?? getNetworkIdForAccount(account);
  const registryUrl = buildRegistryConfigUrlForNetwork(network, account, gateway);
  const targets = selectWorkspaceTargets(input.packages, bosConfig);

  let built: string[] | undefined;
  let skipped: string[] | undefined;

  if (dryRun) {
    return { status: "dry-run", registryUrl, built, skipped };
  }

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
    });
    built = result.built;
    skipped = result.skipped;

    const refreshed = await loadResolvedConfig({ cwd: configDir });
    if (!refreshed?.config) {
      return {
        status: "error",
        registryUrl,
        built,
        skipped,
        error: "Failed to reload bos.config.json after build",
      };
    }

    bosConfig = refreshed.config;
  }

  const rawConfigPath = join(configDir, "bos.config.json");
  const rawConfig = JSON.parse(readFileSync(rawConfigPath, "utf-8")) as BosConfigInput;
  const publishPayload: BosConfigInput = isStaging ? { ...rawConfig, domain: gateway } : rawConfig;

  const registryEntries: Record<string, string> = {
    [`apps/${account}/${gateway}/bos.config.json`]: JSON.stringify(publishPayload),
  };

  const payload = JSON.stringify(registryEntries);
  const argsBase64 = Buffer.from(payload).toString("base64");
  const privateKey =
    input.privateKey || process.env.NEAR_PRIVATE_KEY || process.env.BOS_NEAR_PRIVATE_KEY;
  let signingMode: ReturnType<typeof resolveNearSigningMode>;
  try {
    signingMode = resolveNearSigningMode(privateKey);
  } catch (error) {
    return {
      status: "error" as const,
      registryUrl,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  console.log();
  console.log("  Publishing to:");
  console.log(`    ${colors.cyan(registryUrl)}`);

  try {
    console.log("  Ensuring NEAR CLI...");
    await Effect.runPromise(ensureNearCli);
    console.log("  NEAR CLI ready");
    let txHash: string | undefined;

    console.log(`  Submitting transaction on ${network}...`);

    try {
      const tx = await Effect.runPromise(
        executeTransaction(
          {
            account,
            contract: getRegistryNamespaceForNetwork(network),
            method: "__fastdata_kv",
            argsBase64,
            network,
            privateKey: signingMode._tag === "privateKey" ? signingMode.privateKey : undefined,
            gas: "300Tgas",
            deposit: "0NEAR",
          },
          signingMode,
        ),
      );
      txHash = tx.txHash;
      if (txHash) {
        console.log(`  Transaction submitted: ${colors.dim(txHash)}`);
      }
    } catch (error) {
      txHash = extractTransactionHash(error);

      if (!txHash) {
        throw error;
      }
    }

    console.log("  Waiting for publish confirmation...");
    await waitForPublishedConfig({
      account,
      gateway,
      publishConfig: publishPayload,
    });

    return {
      status: "published",
      registryUrl,
      txHash,
      built,
      skipped,
      publishConfig: publishPayload,
    };
  } catch (error) {
    return {
      status: "error",
      registryUrl,
      error: error instanceof Error ? error.message : "Unknown error",
      built,
      skipped,
    };
  }
}

function extractTransactionHash(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/Transaction ID:\s*([A-Za-z0-9]+)/i);
  return match?.[1];
}

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
