import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { RuntimeOverrideTargetSchema, type RuntimeOverrideTarget } from "./contract";
import { fetchBosConfigFromFastKv } from "./fastkv";
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
  PluginEntryValue,
  RuntimeConfig,
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

export function findConfigPath(cwd?: string): string | null {
  let dir = cwd ?? process.cwd();
  while (dir !== "/") {
    const configPath = join(dir, "bos.config.json");
    if (existsSync(configPath)) {
      return configPath;
    }
    dir = dirname(dir);
  }
  return null;
}

export function getConfig(): BosConfig | null {
  return cachedConfig;
}

export function getProjectRoot(): string {
  if (!projectRoot) {
    throw new Error("Config not loaded. Call loadConfig() first.");
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

export interface RemoteConfigResult {
  rawConfig: BosConfigInput;
  config: BosConfig;
  source: string;
  extendsChain: string[];
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

export async function loadConfig(options?: {
  cwd?: string;
  path?: string;
  env?: BosEnv;
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

    const pluginRuntime = await resolveRuntimePlugins(config.plugins ?? {}, baseDir, runtimeEnv);
    const runtime = buildRuntimeConfig(config, baseDir, runtimeEnv, {
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
    throw new Error(`Failed to load config from ${configPath}: ${error}`);
  }
}

export async function loadBosConfig(options?: {
  cwd?: string;
  path?: string;
  env?: BosEnv;
}): Promise<RuntimeConfig> {
  const result = await loadConfig(options);
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
  return isPlainObject(app.ui) ? (app.ui as Record<string, unknown>) : undefined;
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

async function resolveConfigComposableEntries(
  config: BosConfig,
  baseDir: string,
  env: BosEnv,
): Promise<BosConfig> {
  const resolvedApi = await resolveComposableReference(
    config.app.api as BosPluginRef,
    baseDir,
    env,
    "app.api",
  );
  const resolvedAuth = config.app.auth
    ? await resolveComposableReference(config.app.auth as BosPluginRef, baseDir, env, "app.auth")
    : undefined;

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

export function loadResolvedConfig(configDir: string): BosConfig | null {
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
  return join(configDir, "bos.config.json");
}

export function readBosConfigForBuild(configDir: string): Record<string, unknown> {
  const resolvedPath = getResolvedConfigPath(configDir);
  if (existsSync(resolvedPath)) {
    try {
      const raw = JSON.parse(readFileSync(resolvedPath, "utf-8"));
      if (isPlainObject(raw)) {
        const { _resolved, ...configData } = raw;
        return configData as Record<string, unknown>;
      }
    } catch {}
  }
  const bosConfigPath = join(configDir, "bos.config.json");
  return JSON.parse(readFileSync(bosConfigPath, "utf-8")) as Record<string, unknown>;
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
  if (typeof value === "string") {
    return { extends: value };
  }
  if (!isPlainObject(value)) {
    throw new Error(`Expected config entry object, received ${typeof value}`);
  }
  return value as BosPluginRef;
}

function getTargetedEntry(config: BosConfigInput, targetPath: string): BosPluginRef {
  if (targetPath === "app.api") {
    return asComposableEntry(config.app?.api);
  }

  if (targetPath === "app.auth") {
    return asComposableEntry(config.app?.auth);
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
  return isPlainObject(config.app?.ui) ? (config.app.ui as Record<string, unknown>) : undefined;
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
    const localConfigPath = join(localPath, "bos.config.json");
    if (existsSync(localConfigPath)) {
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

export function buildRuntimeConfig(
  config: BosConfig,
  baseDir: string,
  env: BosEnv,
  options?: BuildRuntimeConfigOptions,
): RuntimeConfig {
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
      : `http://localhost:${hostRuntime.port ?? DEFAULT_HOST_PORT}`;

  const hostIsRemote = hostRuntime.source === "remote";
  const uiIsRemote = uiRuntime.source === "remote";
  const apiIsRemote = apiRuntime.source === "remote";
  const resolvedApiName = resolvePluginRuntimeName(apiConfig.name, apiRuntime.localPath, "api");

  return {
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
      port: hostRuntime.port ?? DEFAULT_HOST_PORT,
      secrets: hostConfig.secrets,
      integrity: hostIsRemote ? hostConfig.integrity : undefined,
      source: hostRuntime.source,
      remoteUrl: hostIsRemote ? hostRuntime.url : undefined,
    },
    shared: config.shared,
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
    },
    auth: (() => {
      if (!authConfig || !authRuntime) return undefined;
      return {
        name: resolvePluginRuntimeName(authConfig.name, authRuntime.localPath, "auth"),
        url: authRuntime.url,
        entry: authRuntime.url ? `${authRuntime.url}/mf-manifest.json` : "/mf-manifest.json",
        localPath: authRuntime.localPath,
        port: authRuntime.port,
        source: authRuntime.source,
        proxy: authConfig.proxy,
        variables: authConfig.variables,
        secrets: authConfig.secrets,
        integrity: authRuntime.source === "remote" ? authConfig.integrity : undefined,
        sidebar: authConfig.sidebar?.map((item) => ({
          ...item,
          to: item.to ?? "/auth",
          roleRequired: item.roleRequired ?? ("member" as const),
        })),
      };
    })(),
    plugins:
      options?.plugins && Object.keys(options.plugins).length > 0 ? options.plugins : undefined,
  };
}

async function loadConfigFile(configPath: string, baseDir: string): Promise<BosConfigInput> {
  if (configPath.startsWith("bos://")) {
    return fetchBosConfigFromFastKv<BosConfigInput>(configPath);
  }

  const resolvedPath = isAbsolute(configPath) ? configPath : resolve(baseDir, configPath);
  return JSON.parse(readFileSync(resolvedPath, "utf-8")) as BosConfigInput;
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
  return raw;
}

async function resolveRuntimePlugins(
  plugins: Record<string, PluginOverrideValue>,
  baseDir: string,
  env: BosEnv,
): Promise<Record<string, RuntimePluginConfig>> {
  const out: Record<string, RuntimePluginConfig> = {};

  for (const [pluginId, rawInput] of Object.entries(plugins)) {
    const normalized = normalizePluginEntry(rawInput);
    if (normalized === null || normalized === false) continue;

    const resolvedReference = await resolveComposableReference(
      normalized,
      baseDir,
      env,
      `plugins.${pluginId}`,
    );

    const pluginRuntime = buildRuntimePluginConfig(pluginId, env, resolvedReference);

    if (!pluginRuntime.localPath && !pluginRuntime.url) {
      continue;
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

    out[pluginId] = pluginRuntime;
  }

  return out;
}

async function resolveRemotePluginRuntimeName(baseUrl: string, fallback: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/plugin.manifest.json`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return fallback;
    }

    const manifest = (await response.json()) as {
      plugin?: { name?: unknown };
    };

    return typeof manifest.plugin?.name === "string" && manifest.plugin.name.length > 0
      ? manifest.plugin.name
      : fallback;
  } catch {
    return fallback;
  }
}

function buildRuntimePluginConfig(
  pluginId: string,
  env: BosEnv,
  resolved: ResolvedComposableReference,
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
          undefined,
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
            undefined,
            `plugins.${pluginId}.ui`,
          )
        : resolveRuntimeTarget(uiProduction, resolved.providerBaseDir, "remote")
      : undefined;

  const sidebar = source.sidebar?.map((item) => ({
    ...item,
    to: item.to ?? `/${pluginId}`,
    roleRequired: item.roleRequired ?? ("member" as const),
  }));

  const routes = source.routes;

  return {
    name: apiName,
    url: runtimeTarget.url,
    entry: runtimeTarget.url
      ? `${runtimeTarget.url.replace(/\/$/, "")}/mf-manifest.json`
      : "/mf-manifest.json",
    source: runtimeTarget.source,
    localPath: runtimeTarget.localPath,
    port: runtimeTarget.port,
    proxy: typeof source.proxy === "string" ? source.proxy : undefined,
    variables: normalizeStringRecord(source.variables),
    secrets: normalizeStringArray(source.secrets),
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
    sidebar,
    routes,
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
  } catch {}

  return fallback;
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      out[key] = raw;
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

export { BOS_CONFIG_ORDER, rebuildOrderedConfig } from "./merge";
export type { BosConfig, RuntimeConfig } from "./types";
export { BosConfigSchema } from "./types";
