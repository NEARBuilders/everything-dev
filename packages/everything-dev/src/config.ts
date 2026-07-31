import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fetchApiPluginManifest } from "./api-contract";
import {
  findBosConfigPath,
  findBosConfigPathInDir,
  readBosConfigSource,
  readBosConfigWithResolvedFallback,
} from "./config-source";
import { manifestPluginsToNodes } from "./dag";
import { fetchBosConfigFromFastKv } from "./fastkv";
import { fetchJsonOrNull } from "./http-client";
import {
  type BosEnv,
  bosConfigMerger,
  isPlainObject,
  mergeBosConfigWithExtends,
  type ResolvedConfigMeta,
  rebuildOrderedConfig,
  resolveExtendsRef,
} from "./merge";
import { getNetworkIdForAccount } from "./network";
import type {
  BosConfig,
  BosConfigInput,
  BosPluginRef,
  ExtendsConfig,
  JsonObject,
  JsonValue,
  PluginEntryValue,
  RuntimeConfig,
  RuntimeDependencyNode,
  RuntimePluginConfig,
} from "./types";
import { BosConfigSchema } from "./types";

const LOCAL_PREFIX = "local:";
const DEFAULT_HOST_PORT = 3000;
const RESOLVED_CONFIG_FILENAME = "bos.resolved-config.json";

type RuntimeOverrideTarget = "ui" | "api" | "plugins" | `plugins.${string}`;

interface RuntimeTarget {
  source: "local" | "remote";
  url: string;
  localPath?: string;
  port?: number;
}

let cachedConfig: BosConfig | null = null;
let projectRoot: string | null = null;
let configWarnings: string[] = [];
let suppressConfigWarnings = false;

export function clearConfigCache(): void {
  cachedConfig = null;
  projectRoot = null;
  configWarnings = [];
}

export function suppressWarnings(): void {
  suppressConfigWarnings = true;
}

export function resumeWarnings(): void {
  suppressConfigWarnings = false;
}

export function drainConfigWarnings(): string[] {
  const warnings = [...configWarnings];
  configWarnings = [];
  return warnings;
}

function emitConfigWarning(message: string): void {
  if (suppressConfigWarnings) {
    configWarnings.push(message);
  } else {
    console.warn(message);
  }
}

const configPathCache = new Map<string, string | null>();

export function findConfigPath(cwd?: string): string | null {
  const cacheKey = cwd ?? process.cwd();
  const cached = configPathCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const configPath = findBosConfigPath(cacheKey);
  configPathCache.set(cacheKey, configPath);
  return configPath;
}

export function getConfig(): BosConfig | null {
  return cachedConfig;
}

export function getProjectRoot(): string {
  if (!projectRoot) {
    throw new Error("Config not loaded. Call loadResolvedConfig() first.");
  }
  return projectRoot;
}

export interface ConfigResult {
  config: BosConfig;
  runtime: RuntimeConfig;
  source: {
    path: string;
    extended?: string[];
    remote?: boolean;
  };
  warnings?: string[];
}

export interface LocalConfigResult {
  config: BosConfigInput;
  source: {
    path: string;
  };
}

export interface RemoteConfigResult {
  rawConfig: BosConfigInput;
  config: BosConfig;
  source: string;
  extendsChain: string[];
}

export interface ResolvedComposableReference {
  entry: BosPluginRef;
  providerBaseDir: string;
  targetPath: string;
  associatedUi?: Record<string, unknown>;
}

interface ParsedExtendsTarget {
  configPath: string;
  targetPath?: string;
}

export async function loadLocalConfig(options?: {
  cwd?: string;
  path?: string;
}): Promise<LocalConfigResult | null> {
  const configPath = options?.path ?? findConfigPath(options?.cwd);
  if (!configPath) {
    projectRoot = options?.cwd ?? process.cwd();
    return null;
  }

  const baseDir = dirname(configPath);
  const config = await loadConfigFile(configPath, baseDir);

  projectRoot = baseDir;

  return {
    config,
    source: {
      path: configPath,
    },
  };
}

export async function loadResolvedConfig(options?: {
  cwd?: string;
  path?: string;
  env?: BosEnv;
  remotePlugins?: string[];
}): Promise<ConfigResult | null> {
  const configPath = options?.path ?? findConfigPath(options?.cwd);
  if (!configPath) {
    projectRoot = options?.cwd ?? process.cwd();
    return null;
  }

  const baseDir = dirname(configPath);
  const env = options?.env ?? "development";
  const runtimeEnv: BosEnv = env === "staging" ? "production" : env;

  try {
    suppressWarnings();
    const extendedChain: string[] = [];
    const parsed = await resolveConfigWithExtends(
      configPath,
      baseDir,
      new Set(),
      extendedChain,
      env,
    );
    const config = await resolveConfigComposableEntries(
      BosConfigSchema.parse(parsed),
      baseDir,
      runtimeEnv,
    );

    cachedConfig = config;
    projectRoot = baseDir;

    const pluginRuntime = await resolveRuntimePlugins(
      config.plugins ?? {},
      baseDir,
      runtimeEnv,
      options?.remotePlugins,
    );
    const runtime = await buildRuntimeConfig(config, baseDir, runtimeEnv, {
      plugins: pluginRuntime,
    });
    const warnings = drainConfigWarnings();
    resumeWarnings();

    return {
      config,
      runtime,
      source: {
        path: configPath,
        extended: extendedChain.length > 0 ? extendedChain : undefined,
        remote: extendedChain.some((entry) => entry.startsWith("bos://")),
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    resumeWarnings();
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${configPath}: ${error.message}`, {
        cause: error,
      });
    }
    throw new Error(`Failed to load config from ${configPath}: ${String(error)}`);
  }
}

export async function loadBosConfig(options?: {
  cwd?: string;
  path?: string;
  env?: BosEnv;
}): Promise<RuntimeConfig> {
  const result = await loadResolvedConfig(options);
  if (!result) {
    throw new Error("No bos.config.json found");
  }

  return result.runtime;
}

export async function loadRemoteConfig(
  bosUrl: string,
  env: BosEnv = "production",
): Promise<RemoteConfigResult> {
  const runtimeEnv: BosEnv = env === "staging" ? "production" : env;
  const extendedChain: string[] = [];
  const parsed = await resolveConfigWithExtends(
    bosUrl,
    process.cwd(),
    new Set(),
    extendedChain,
    env,
  );
  const config = await resolveConfigComposableEntries(
    BosConfigSchema.parse(parsed),
    process.cwd(),
    runtimeEnv,
  );

  return {
    rawConfig: await loadConfigFile(bosUrl, process.cwd()),
    config,
    source: bosUrl,
    extendsChain: extendedChain,
  };
}

export function parseRuntimeOverrideTargets(value?: string | null): RuntimeOverrideTarget[] {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].map((entry) => {
    if (entry === "ui" || entry === "api" || entry === "plugins") {
      return entry;
    }

    if (entry.startsWith("plugins.") && entry.length > "plugins.".length) {
      return entry as RuntimeOverrideTarget;
    }

    throw new Error(`Invalid runtime override target: ${entry}`);
  });
}

export function isRuntimeOverrideAllowed(
  allowedTargets: ReadonlyArray<RuntimeOverrideTarget>,
  target: "ui" | "api" | "plugins" | `plugins.${string}`,
): boolean {
  if (allowedTargets.includes(target as RuntimeOverrideTarget)) {
    return true;
  }

  if (target.startsWith("plugins.")) {
    return allowedTargets.includes("plugins.*");
  }

  return false;
}

export async function buildRuntimePluginsForConfig(
  config: BosConfig,
  baseDir: string,
  env: BosEnv,
): Promise<Record<string, RuntimePluginConfig> | undefined> {
  const plugins = await resolveRuntimePlugins(config.plugins ?? {}, baseDir, env);
  return Object.keys(plugins).length > 0 ? plugins : undefined;
}

function getEntryAssociatedUi(entry: Partial<BosPluginRef>): Record<string, unknown> | undefined {
  if (!isPlainObject(entry.app)) {
    return undefined;
  }

  const app = entry.app as Record<string, unknown>;
  if (!isPlainObject(app.ui)) {
    return undefined;
  }

  const ui = app.ui as Record<string, unknown>;
  if ("shared" in ui) {
    throw new Error(
      "app.ui.shared is no longer supported. Move shared deps to app.api.shared, app.auth.shared, or plugins.*.shared.",
    );
  }

  return ui;
}

function mergeAssociatedUi(
  parentUi: Record<string, unknown> | undefined,
  childUi: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!parentUi) {
    return childUi ? { ...childUi } : undefined;
  }

  if (!childUi) {
    return { ...parentUi };
  }

  return bosConfigMerger({ ...childUi }, parentUi) as Record<string, unknown>;
}

function withAssociatedUi(
  entry: BosPluginRef,
  associatedUi?: Record<string, unknown>,
): BosPluginRef {
  if (!associatedUi) {
    return entry;
  }

  const app = isPlainObject(entry.app)
    ? ({ ...(entry.app as Record<string, unknown>) } as Record<string, unknown>)
    : {};
  app.ui = mergeAssociatedUi(getEntryAssociatedUi(entry), associatedUi);

  return {
    ...entry,
    app,
  };
}

export async function resolveConfigComposableEntries(
  config: BosConfig,
  baseDir: string,
  env: BosEnv,
): Promise<BosConfig> {
  const [resolvedApi, resolvedAuth] = await Promise.all([
    resolveComposableReference(config.app.api as BosPluginRef, baseDir, env, "app.api"),
    config.app.auth
      ? resolveComposableReference(config.app.auth as BosPluginRef, baseDir, env, "app.auth")
      : Promise.resolve(undefined),
  ]);

  const resolvedPlugins = config.plugins
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(config.plugins).map(async ([pluginId, pluginValue]) => {
            const resolvedPlugin = await resolveComposableReference(
              asComposableEntry(pluginValue),
              baseDir,
              env,
              `plugins.${pluginId}`,
            );

            return [
              pluginId,
              withAssociatedUi(resolvedPlugin.entry, resolvedPlugin.associatedUi),
            ] as const;
          }),
        ),
      )
    : undefined;

  return {
    ...config,
    app: {
      ...config.app,
      api: resolvedApi.entry,
      auth: resolvedAuth?.entry,
    },
    plugins: resolvedPlugins,
  };
}

export function getResolvedConfigPath(configDir: string): string {
  return join(configDir, ".bos", RESOLVED_CONFIG_FILENAME);
}

export function loadGeneratedResolvedConfig(configDir: string): BosConfig | null {
  const resolvedPath = getResolvedConfigPath(configDir);
  if (!existsSync(resolvedPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(resolvedPath, "utf-8"));
    if (!isPlainObject(raw)) return null;
    const { _resolved, ...configData } = raw;
    return BosConfigSchema.parse(configData);
  } catch {
    return null;
  }
}

export function writeResolvedConfig(
  configDir: string,
  config: BosConfig,
  env: BosEnv,
  extendsChain?: string[],
  source?: string,
): void {
  const resolvedPath = getResolvedConfigPath(configDir);
  const resolvedDir = dirname(resolvedPath);
  if (!existsSync(resolvedDir)) {
    mkdirSync(resolvedDir, { recursive: true });
  }

  const ordered = rebuildOrderedConfig(config);
  const meta: ResolvedConfigMeta = {
    env,
    resolvedAt: new Date().toISOString(),
    extendsChain: extendsChain ?? [],
    ...(source ? { source } : {}),
  };
  const output = {
    _resolved: meta,
    ...ordered,
  };

  const content = `${JSON.stringify(output, null, 2)}\n`;
  try {
    if (readFileSync(resolvedPath, "utf-8") === content) return;
  } catch {
    // file doesn't exist yet
  }
  writeFileSync(resolvedPath, content);
}

export function resolveBosConfigPath(configDir: string): string {
  const resolvedPath = getResolvedConfigPath(configDir);
  if (existsSync(resolvedPath)) return resolvedPath;
  return findBosConfigPath(configDir) ?? join(configDir, "bos.config.json");
}

export function readBosConfigForBuild(configDir: string): Record<string, unknown> {
  return readBosConfigWithResolvedFallback(configDir);
}

function parseExtendsTarget(ref: string): ParsedExtendsTarget {
  const hashIndex = ref.indexOf("#");
  if (hashIndex === -1) {
    return { configPath: ref };
  }

  const configPath = ref.slice(0, hashIndex);
  const targetPath = ref.slice(hashIndex + 1);
  return {
    configPath,
    targetPath: targetPath.length > 0 ? targetPath : undefined,
  };
}

function getConfigBaseDir(configPath: string, baseDir: string): string {
  if (configPath.startsWith("bos://")) return baseDir;
  return dirname(isAbsolute(configPath) ? configPath : resolve(baseDir, configPath));
}

function asComposableEntry(value: unknown): BosPluginRef {
  if (value === undefined) {
    return {};
  }
  if (typeof value === "string") {
    return { extends: value };
  }
  if (!isPlainObject(value)) {
    throw new Error(`Expected config entry object, received ${typeof value}`);
  }
  return value as BosPluginRef;
}

function getTargetedEntry(config: BosConfigInput, targetPath: string): BosPluginRef {
  if (targetPath.startsWith("app.")) {
    const entryKey = targetPath.slice("app.".length);
    return asComposableEntry(config.app?.[entryKey]);
  }

  if (targetPath.startsWith("plugins.")) {
    const pluginId = targetPath.slice("plugins.".length);
    if (pluginId.length === 0) {
      throw new Error(`Invalid plugin target path: ${targetPath}`);
    }
    return asComposableEntry(config.plugins?.[pluginId]);
  }

  throw new Error(`Unsupported extends target path: ${targetPath}`);
}

function getAssociatedUi(
  config: BosConfigInput,
  _targetPath: string,
): Record<string, unknown> | undefined {
  if (!isPlainObject(config.app?.ui)) {
    return undefined;
  }

  const ui = config.app.ui as Record<string, unknown>;
  if ("shared" in ui) {
    throw new Error(
      "app.ui.shared is no longer supported. Move shared deps to app.api.shared, app.auth.shared, or plugins.*.shared.",
    );
  }

  return ui;
}

function mergeComposableEntries(
  parent: Partial<BosPluginRef>,
  child: Partial<BosPluginRef>,
): BosPluginRef {
  return bosConfigMerger({ ...child }, parent) as BosPluginRef;
}

function stripUnsafeLocalDevelopment<T extends Record<string, unknown> | undefined>(
  entry: T,
  allowLocalPaths: boolean,
): T {
  if (!entry || allowLocalPaths) {
    return entry;
  }

  if (typeof entry.development === "string" && entry.development.startsWith(LOCAL_PREFIX)) {
    const { development: _ignored, ...rest } = entry;
    return rest as T;
  }

  return entry;
}

export async function resolveComposableReference(
  source: BosPluginRef,
  baseDir: string,
  env: BosEnv,
  defaultTargetPath: string,
): Promise<ResolvedComposableReference> {
  let resolvedEntry: BosPluginRef = {};
  let providerBaseDir = baseDir;
  let targetPath = defaultTargetPath;
  let associatedUi = getEntryAssociatedUi(source);
  let allowLocalPaths = false;
  let extendsError: unknown;

  const extendsRef = source.extends ? resolveExtendsRef(source.extends, env) : undefined;
  if (extendsRef) {
    const parsed = parseExtendsTarget(extendsRef);
    targetPath = parsed.targetPath ?? defaultTargetPath;
    const extendsBaseDir = getConfigBaseDir(parsed.configPath, baseDir);
    try {
      const extendedConfig = await resolveConfigWithExtends(
        parsed.configPath,
        extendsBaseDir,
        new Set(),
        [],
        env,
      );
      resolvedEntry = mergeComposableEntries(
        resolvedEntry,
        getTargetedEntry(extendedConfig, targetPath),
      );
      providerBaseDir = extendsBaseDir;
      associatedUi = mergeAssociatedUi(associatedUi, getAssociatedUi(extendedConfig, targetPath));
    } catch (error) {
      extendsError = error;
    }
  }

  const localDevelopment =
    typeof source.development === "string" && source.development.startsWith(LOCAL_PREFIX)
      ? source.development
      : undefined;
  const localDevelopmentPath = localDevelopment
    ? resolve(baseDir, localDevelopment.slice(LOCAL_PREFIX.length).trim())
    : undefined;
  const hasUsableLocalDevelopment = Boolean(
    localDevelopmentPath && existsSync(localDevelopmentPath),
  );

  if (localDevelopmentPath) {
    const localPath = localDevelopmentPath;
    const localConfigPath = findBosConfigPathInDir(localPath);
    if (localConfigPath) {
      const localConfig = await resolveConfigWithExtends(
        localConfigPath,
        localPath,
        new Set(),
        [],
        env,
      );
      resolvedEntry = mergeComposableEntries(
        resolvedEntry,
        getTargetedEntry(localConfig, targetPath),
      );
      providerBaseDir = localPath;
      associatedUi = mergeAssociatedUi(associatedUi, getAssociatedUi(localConfig, targetPath));
      allowLocalPaths = true;
    }
  }

  const sourceOverrides = { ...source };
  if (allowLocalPaths && localDevelopment) {
    delete sourceOverrides.development;
  }

  resolvedEntry = mergeComposableEntries(resolvedEntry, sourceOverrides);
  associatedUi = mergeAssociatedUi(associatedUi, getEntryAssociatedUi(sourceOverrides));

  if (extendsError && !allowLocalPaths && !hasUsableLocalDevelopment) {
    throw extendsError;
  }

  return {
    entry: stripUnsafeLocalDevelopment(resolvedEntry, allowLocalPaths || Boolean(localDevelopment)),
    providerBaseDir,
    targetPath,
    associatedUi: stripUnsafeLocalDevelopment(associatedUi, allowLocalPaths),
  };
}

function resolveDevelopmentTarget(
  development: string | undefined,
  production: string | undefined,
  baseDir: string,
  forceSource?: "local" | "remote",
  target?: string,
  extendsRef?: string,
): RuntimeTarget {
  if (forceSource === "remote") {
    return resolveRuntimeTarget(production, baseDir, "remote");
  }
  if (!development) {
    if (production && target) {
      if (extendsRef) {
        emitConfigWarning(`[Config] Resolving "${target}" from ${extendsRef}`);
      } else {
        emitConfigWarning(`[Config] No development target for "${target}", using production`);
      }
    }
    return resolveRuntimeTarget(production, baseDir, "remote");
  }
  const devTarget = resolveRuntimeTarget(development, baseDir);
  if (devTarget.source === "local" && (!devTarget.localPath || !existsSync(devTarget.localPath))) {
    if (production && target) {
      emitConfigWarning(`[Config] Could not load local target for "${target}", using production`);
    }
    return resolveRuntimeTarget(production, baseDir, "remote");
  }
  return devTarget;
}

export interface BuildRuntimeConfigOptions {
  plugins?: Record<string, RuntimePluginConfig>;
  hostSource?: "local" | "remote";
  uiSource?: "local" | "remote";
  apiSource?: "local" | "remote";
  authSource?: "local" | "remote";
  proxy?: string;
}

export async function buildRuntimeConfig(
  config: BosConfig,
  baseDir: string,
  env: BosEnv,
  options?: BuildRuntimeConfigOptions,
): Promise<RuntimeConfig> {
  const uiConfig = config.app.ui;
  const apiConfig = config.app.api;
  const authConfig = config.app.auth;
  const uiRuntime =
    env === "development"
      ? resolveDevelopmentTarget(
          uiConfig.development,
          uiConfig.production,
          baseDir,
          options?.uiSource,
          "app.ui",
        )
      : resolveRuntimeTarget(uiConfig.production, baseDir, "remote");
  const apiRuntime =
    env === "development"
      ? resolveDevelopmentTarget(
          apiConfig.development,
          apiConfig.production,
          baseDir,
          options?.apiSource,
          "app.api",
        )
      : resolveRuntimeTarget(apiConfig.production, baseDir, "remote");
  const authExtendsRef = authConfig?.extends
    ? resolveExtendsRef(authConfig.extends, env)
    : undefined;
  const authRuntime = authConfig
    ? env === "development"
      ? resolveDevelopmentTarget(
          authConfig.development,
          authConfig.production,
          baseDir,
          options?.authSource,
          "app.auth",
          authExtendsRef,
        )
      : resolveRuntimeTarget(authConfig.production, baseDir, "remote")
    : undefined;

  const hostConfig = config.app.host;
  const hostRuntime =
    env === "development"
      ? resolveDevelopmentTarget(
          hostConfig.development,
          hostConfig.production,
          baseDir,
          options?.hostSource,
          "app.host",
        )
      : resolveRuntimeTarget(hostConfig.production, baseDir, "remote");

  const hostListeningUrl =
    env === "development"
      ? resolveDevelopmentHostUrl(hostConfig.development)
      : `http://localhost:${DEFAULT_HOST_PORT}`;

  const hostIsRemote = hostRuntime.source === "remote";
  const uiIsRemote = uiRuntime.source === "remote";
  const apiIsRemote = apiRuntime.source === "remote";
  const resolvedApiName = resolvePluginRuntimeName(apiConfig.name, apiRuntime.localPath, "api");

  const result: RuntimeConfig = {
    env,
    account: config.account,
    domain: config.domain,
    title: config.title,
    description: config.description,
    networkId: getNetworkIdForAccount(config.account),
    repository: config.repository,
    host: {
      name: "host",
      url: hostListeningUrl,
      entry: `${hostListeningUrl}/mf-manifest.json`,
      localPath: hostRuntime.localPath,
      port: env === "development" ? parsePort(hostListeningUrl) : DEFAULT_HOST_PORT,
      secrets: hostConfig.secrets,
      integrity: hostIsRemote ? hostConfig.integrity : undefined,
      source: hostRuntime.source,
      remoteUrl: hostIsRemote ? hostRuntime.url : undefined,
    },
    ui: {
      name: resolvePluginRuntimeName(uiConfig.name, uiRuntime.localPath, "ui"),
      url: uiRuntime.url,
      entry: uiRuntime.url ? `${uiRuntime.url}/mf-manifest.json` : "/mf-manifest.json",
      localPath: uiRuntime.localPath,
      port: uiRuntime.port,
      ssrUrl: uiIsRemote ? uiConfig.ssr : undefined,
      ssrIntegrity: uiIsRemote ? uiConfig.ssrIntegrity : undefined,
      integrity: uiIsRemote ? uiConfig.integrity : undefined,
      source: uiRuntime.source,
    },
    api: {
      name: resolvedApiName,
      url: apiRuntime.url,
      entry: apiRuntime.url ? `${apiRuntime.url}/mf-manifest.json` : "/mf-manifest.json",
      localPath: apiRuntime.localPath,
      port: apiRuntime.port,
      source: apiRuntime.source,
      proxy: options?.proxy ?? apiConfig.proxy,
      variables: apiConfig.variables,
      secrets: apiConfig.secrets,
      integrity: apiIsRemote ? apiConfig.integrity : undefined,
      shared: apiConfig.shared,
    },
    auth: (() => {
      if (!authConfig || !authRuntime) return undefined;
      if (!authRuntime.localPath && !authRuntime.url) return undefined;
      return {
        name: resolvePluginRuntimeName(authConfig.name, authRuntime.localPath, "auth"),
        extendsRef: authExtendsRef,
        url: authRuntime.url,
        entry: authRuntime.url ? `${authRuntime.url}/mf-manifest.json` : "/mf-manifest.json",
        localPath: authRuntime.localPath,
        port: authRuntime.port,
        source: authRuntime.source,
        proxy: authConfig.proxy,
        variables: authConfig.variables,
        secrets: authConfig.secrets,
        integrity: authRuntime.source === "remote" ? authConfig.integrity : undefined,
        shared: authConfig.shared,
      };
    })(),
    plugins:
      options?.plugins && Object.keys(options.plugins).length > 0 ? options.plugins : undefined,
  };

  let manifestNodes: RuntimeDependencyNode[] = [];
  const manifestPluginEntries: Array<{ key: string; config: RuntimePluginConfig }> = [];

  if (result.api.source === "remote" && result.api.url) {
    try {
      const manifest = await fetchApiPluginManifest(result.api.url);
      if (manifest.plugins?.length) {
        manifestNodes = manifestPluginsToNodes(manifest.plugins);
        for (const node of manifestNodes) {
          if (!result.plugins?.[node.key]) {
            manifestPluginEntries.push({
              key: node.key,
              config: {
                name: node.name,
                url: node.url,
                entry: node.entry,
                source: "remote",
                dependsOn: node.dependsOn,
                secrets: node.secrets,
                variables: node.variables,
              },
            });
            if (node.secrets) {
              for (const secretName of node.secrets) {
                if (!process.env[secretName]) {
                  console.warn(
                    `[Config] Plugin "${node.key}" (discovered from manifest) expects secret "${secretName}" but it is not set in the environment.`,
                  );
                }
              }
            }
          }
        }
      }
      if (manifest.dependsOn?.length) {
        const existing = new Set(result.api.dependsOn ?? []);
        for (const dep of manifest.dependsOn) {
          if (!existing.has(dep)) {
            result.api.dependsOn = [...(result.api.dependsOn ?? []), dep];
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Config] Failed to fetch API plugin manifest for discovery: ${message}`);
    }
  }

  if (manifestPluginEntries.length > 0) {
    if (!result.plugins) result.plugins = {};
    for (const { key, config } of manifestPluginEntries) {
      if (!result.plugins[key]) {
        result.plugins[key] = config;
      }
    }
  }

  return result;
}

async function loadConfigFile(configPath: string, baseDir: string): Promise<BosConfigInput> {
  if (configPath.startsWith("bos://")) {
    return fetchBosConfigFromFastKv<BosConfigInput>(configPath);
  }

  const resolvedPath = isAbsolute(configPath) ? configPath : resolve(baseDir, configPath);
  return readBosConfigSource(resolvedPath);
}

async function resolveConfigWithExtends(
  configPath: string,
  baseDir: string,
  visited: Set<string>,
  chain: string[],
  env: BosEnv = "development",
): Promise<BosConfigInput> {
  if (visited.has(configPath)) {
    throw new Error(`Circular extends detected: ${[...visited, configPath].join(" -> ")}`);
  }

  const config = await loadConfigFile(configPath, baseDir);
  chain.push(configPath);

  if (!config.extends) {
    return config;
  }

  const extendsRef = resolveExtendsRef(config.extends as string | ExtendsConfig, env);
  if (!extendsRef) {
    return config;
  }

  const parsedParentRef = parseExtendsTarget(extendsRef);

  const nextVisited = new Set(visited);
  nextVisited.add(configPath);
  const parentBaseDir = getConfigBaseDir(parsedParentRef.configPath, baseDir);
  const parent = await resolveConfigWithExtends(
    parsedParentRef.configPath,
    parentBaseDir,
    nextVisited,
    chain,
    env,
  );

  return mergeBosConfigWithExtends(parent, config);
}

type PluginOverrideValue = PluginEntryValue | null | false;

function normalizePluginEntry(raw: PluginOverrideValue): BosPluginRef | null | false {
  if (raw === null || raw === false) return raw;
  if (typeof raw === "string") {
    return { extends: raw };
  }
  if (raw.disabled === true) return null;
  return raw;
}

async function resolveRuntimePlugins(
  plugins: Record<string, PluginOverrideValue>,
  baseDir: string,
  env: BosEnv,
  remotePlugins?: string[],
): Promise<Record<string, RuntimePluginConfig>> {
  const entries = Object.entries(plugins)
    .map(([pluginId, rawInput]) => ({
      pluginId,
      normalized: normalizePluginEntry(rawInput),
    }))
    .filter(
      (entry): entry is { pluginId: string; normalized: BosPluginRef } =>
        entry.normalized !== null && entry.normalized !== false,
    );

  const resolved = await Promise.all(
    entries.map(async ({ pluginId, normalized }) => {
      const resolvedReference = await resolveComposableReference(
        normalized,
        baseDir,
        env,
        `plugins.${pluginId}`,
      );

      const forceSource =
        remotePlugins === undefined
          ? undefined
          : remotePlugins.length === 0 || remotePlugins.includes(pluginId)
            ? "remote"
            : undefined;
      const pluginRuntime = buildRuntimePluginConfig(pluginId, env, resolvedReference, forceSource);

      if (!pluginRuntime.localPath && !pluginRuntime.url) {
        if (forceSource === "remote") {
          emitConfigWarning(
            `[Config] Plugin "${pluginId}" has no production URL in bos.config.json and cannot be resolved as remote. Add a "production" field or remove it from --remote-plugins.`,
          );
        }
        return null;
      }

      if (
        pluginRuntime.source === "remote" &&
        pluginRuntime.url &&
        !pluginRuntime.localPath &&
        typeof resolvedReference.entry.name !== "string"
      ) {
        pluginRuntime.name = await resolveRemotePluginRuntimeName(
          pluginRuntime.url,
          pluginRuntime.name,
        );
      }

      return [pluginId, pluginRuntime] as const;
    }),
  );

  const out: Record<string, RuntimePluginConfig> = {};
  for (const entry of resolved) {
    if (entry) {
      out[entry[0]] = entry[1];
    }
  }

  return out;
}

async function resolveRemotePluginRuntimeName(baseUrl: string, fallback: string): Promise<string> {
  const manifest = await fetchJsonOrNull<{
    plugin?: { name?: unknown };
  }>(`${baseUrl.replace(/\/$/, "")}/plugin.manifest.json`, { retries: 0 });

  return typeof manifest?.plugin?.name === "string" && manifest.plugin.name.length > 0
    ? manifest.plugin.name
    : fallback;
}

function buildRuntimePluginConfig(
  pluginId: string,
  env: BosEnv,
  resolved: ResolvedComposableReference,
  forceSource?: "local" | "remote",
): RuntimePluginConfig {
  const source = resolved.entry;
  const development = typeof source.development === "string" ? source.development : undefined;
  const production = typeof source.production === "string" ? source.production : undefined;

  if (production?.startsWith("bos://")) {
    throw new Error(
      `Plugin "${pluginId}" has unsupported production target "${production}". Use extends: "bos://account/domain" for plugin configs or a CDN URL for production.`,
    );
  }

  const pluginExtendsRef = source.extends ? resolveExtendsRef(source.extends, env) : undefined;

  const runtimeTarget =
    env === "development"
      ? resolveDevelopmentTarget(
          development,
          production,
          resolved.providerBaseDir,
          forceSource,
          `plugins.${pluginId}`,
          pluginExtendsRef,
        )
      : resolveRuntimeTarget(production, resolved.providerBaseDir, "remote");
  const apiName = resolvePluginRuntimeName(source.name, runtimeTarget.localPath, pluginId);

  const uiConfig = resolved.associatedUi;
  const uiDevelopment =
    typeof uiConfig?.development === "string" ? uiConfig.development : undefined;
  const uiProduction = typeof uiConfig?.production === "string" ? uiConfig.production : undefined;
  const uiRuntime =
    uiConfig && (uiDevelopment || uiProduction)
      ? env === "development"
        ? resolveDevelopmentTarget(
            uiDevelopment,
            uiProduction,
            resolved.providerBaseDir,
            forceSource,
            `plugins.${pluginId}.ui`,
          )
        : resolveRuntimeTarget(uiProduction, resolved.providerBaseDir, "remote")
      : undefined;

  const routes = source.routes;

  return {
    name: apiName,
    url: runtimeTarget.url,
    entry: runtimeTarget.url
      ? `${runtimeTarget.url.replace(/\/$/, "")}/mf-manifest.json`
      : "/mf-manifest.json",
    source: runtimeTarget.source,
    extendsRef: pluginExtendsRef,
    localPath: runtimeTarget.localPath,
    port: runtimeTarget.port,
    proxy: typeof source.proxy === "string" ? source.proxy : undefined,
    variables: normalizeJsonRecord(source.variables),
    secrets: normalizeStringArray(source.secrets),
    shared: source.shared,
    integrity: runtimeTarget.source === "remote" ? source.integrity : undefined,
    ui: uiRuntime
      ? {
          name: typeof uiConfig?.name === "string" ? uiConfig.name : `${apiName}-ui`,
          url: uiRuntime.url,
          entry: uiRuntime.url
            ? `${uiRuntime.url.replace(/\/$/, "")}/mf-manifest.json`
            : "/mf-manifest.json",
          source: uiRuntime.source,
          localPath: uiRuntime.localPath,
          port: uiRuntime.port,
          integrity:
            uiRuntime.source === "remote" && typeof uiConfig?.integrity === "string"
              ? uiConfig.integrity
              : undefined,
        }
      : undefined,
    routes,
    dependsOn: source.dependsOn ? normalizeStringArray(source.dependsOn) : undefined,
  };
}

export function resolvePluginRuntimeName(
  explicitName: string | undefined,
  localPath: string | undefined,
  fallback: string,
): string {
  if (explicitName) {
    return explicitName;
  }

  if (!localPath) {
    return fallback;
  }

  try {
    const packageJsonPath = join(localPath, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: unknown };
    if (typeof packageJson.name === "string" && packageJson.name.length > 0) {
      return packageJson.name;
    }
  } catch (e) {
    console.warn(`[Config] Could not read package.json at ${localPath}: ${e}`);
  }

  return fallback;
}

function normalizeJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeJsonValue(item))
      .filter((item): item is JsonValue => item !== undefined);
  }

  if (isPlainObject(value)) {
    const out: JsonObject = {};
    for (const [key, raw] of Object.entries(value)) {
      const normalized = normalizeJsonValue(raw);
      if (normalized !== undefined) {
        out[key] = normalized;
      }
    }
    return out;
  }

  return undefined;
}

function normalizeJsonRecord(value: unknown): JsonObject | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: JsonObject = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = normalizeJsonValue(raw);
    if (normalized !== undefined) {
      out[key] = normalized;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return out.length > 0 ? out : undefined;
}

function resolveRuntimeTarget(
  value: string | undefined,
  baseDir: string,
  defaultSource: "local" | "remote" = "remote",
): RuntimeTarget {
  if (!value) {
    return { source: defaultSource, url: "" };
  }

  if (value.startsWith(LOCAL_PREFIX)) {
    const localTarget = value?.slice(LOCAL_PREFIX.length).trim();
    if (!localTarget) {
      throw new Error(`Invalid local development target: ${value}`);
    }

    const localPath = resolve(baseDir, localTarget);
    if (!existsSync(localPath)) {
      return { source: "local", url: "" };
    }

    return {
      source: "local",
      url: "",
      localPath,
    };
  }

  return {
    source: defaultSource,
    url: value.replace(/\/$/, ""),
    port: parsePort(value),
  };
}

export function isLocalDevelopmentTarget(
  value: string | undefined,
): value is `${typeof LOCAL_PREFIX}${string}` {
  return typeof value === "string" && value.startsWith(LOCAL_PREFIX);
}

export function resolveLocalDevelopmentPath(
  value: string | undefined,
  baseDir: string,
): string | null {
  if (!isLocalDevelopmentTarget(value)) {
    return null;
  }

  const localTarget = value.slice(LOCAL_PREFIX.length).trim();
  return localTarget ? resolve(baseDir, localTarget) : null;
}

export function resolveDevelopmentHostUrl(value: string | undefined): string {
  if (!value || isLocalDevelopmentTarget(value)) {
    return `http://localhost:${DEFAULT_HOST_PORT}`;
  }

  return value.replace(/\/$/, "");
}

export function getHostDevelopmentPort(value: string | undefined): number {
  return parsePort(resolveDevelopmentHostUrl(value));
}

export function parsePort(url: string): number {
  try {
    const parsed = new URL(url);
    return parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return 3000;
  }
}

export {
  BOS_CONFIG_ORDER,
  mergeBosConfigWithExtends,
  rebuildOrderedConfig,
  resolveExtendsRef,
} from "./merge";
export type { BosConfig, RuntimeConfig } from "./types";
export { BosConfigSchema } from "./types";
