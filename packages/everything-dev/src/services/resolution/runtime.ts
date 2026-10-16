import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import { sanitizeContainerName } from "every-plugin/ui/manifest/contract";
import { fetchApiPluginManifest } from "../../api-contract";
import { getProcessEnv } from "../../env/process-env";
import { fetchJsonOrNull } from "../../http-client";
import { getNetworkIdForAccount } from "../../network";
import type {
  BosConfig,
  BosPluginRef,
  JsonObject,
  JsonValue,
  PluginEntryValue,
  RuntimeConfig,
  RuntimePluginConfig,
} from "../../types";
import { type ResolvedSlotVersion, resolveSlotVersion } from "../../version-manifest-resolve";
import { manifestPluginsToNodes } from "../registry/dag";
import {
  ConfigExtendsError,
  ConfigVersionManifestError,
  emitConfigWarning,
  getEntryAssociatedUi,
  LOCAL_PREFIX,
  type ResolvedComposableReference,
  resolveComposableReference,
} from "./load";
import { type BosEnv, isPlainObject, resolveExtendsRef } from "./merge";

const warnOutsideEffect = (...args: unknown[]): void => {
  console.warn(...args);
};

const DEFAULT_HOST_PORT = 3000;

interface RuntimeTarget {
  source: "local" | "remote";
  url: string;
  localPath?: string;
  port?: number;
}

export async function buildRuntimePluginsForConfig(
  config: BosConfig,
  baseDir: string,
  env: BosEnv,
  remotePlugins?: string[],
): Promise<Record<string, RuntimePluginConfig> | undefined> {
  const plugins = await resolveRuntimePlugins(config.plugins ?? {}, baseDir, env, remotePlugins);
  return Object.keys(plugins).length > 0 ? plugins : undefined;
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

export const buildRuntimeConfigEffect = Effect.fn("buildRuntimeConfig")(function* (
  config: BosConfig,
  baseDir: string,
  env: BosEnv,
  options?: BuildRuntimeConfigOptions,
): Effect.fn.Return<RuntimeConfig, ConfigExtendsError | ConfigVersionManifestError> {
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
      : `http://localhost:${getProcessEnv("PORT") ?? DEFAULT_HOST_PORT}`;

  const hostIsRemote = hostRuntime.source === "remote";
  const uiIsRemote = uiRuntime.source === "remote";
  const apiIsRemote = apiRuntime.source === "remote";
  const resolvedApiName = resolvePluginRuntimeName(apiConfig.name, apiRuntime.localPath, "api");

  const authEntry = yield* Effect.tryPromise({
    try: async () => {
      if (!authConfig || !authRuntime) return undefined;
      if (!authRuntime.localPath && !authRuntime.url) return undefined;
      let authName = resolvePluginRuntimeName(authConfig.name, authRuntime.localPath, "auth");
      if (
        authRuntime.source === "remote" &&
        authRuntime.url &&
        !authRuntime.localPath &&
        typeof authConfig.name !== "string"
      ) {
        authName = await resolveRemotePluginRuntimeName(authRuntime.url, authName);
      }
      return {
        name: authName,
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
        ui: buildRuntimeUiConfig(
          "auth",
          env,
          getEntryAssociatedUi(authConfig as Partial<BosPluginRef>),
          baseDir,
          authName,
          options?.authSource,
        ),
      };
    },
    catch: (cause) => new ConfigExtendsError({ message: String(cause), cause }),
  });

  const explicitPlugins =
    options?.plugins && Object.keys(options.plugins).length > 0 ? options.plugins : undefined;
  const runtimePlugins: Record<string, RuntimePluginConfig> = { ...explicitPlugins };
  if (authEntry && !runtimePlugins.auth) {
    runtimePlugins.auth = authEntry;
  }

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
      port:
        env === "development"
          ? parsePort(hostListeningUrl)
          : Number(getProcessEnv("PORT")) || DEFAULT_HOST_PORT,
      secrets: hostConfig.secrets,
      integrity: hostIsRemote ? hostConfig.integrity : undefined,
      source: hostRuntime.source,
      remoteUrl: hostIsRemote ? hostRuntime.url : undefined,
    },
    ui: {
      name: resolvePluginRuntimeName(uiConfig.name, uiRuntime.localPath, "ui"),
      url: uiRuntime.url,
      entry: uiRuntime.url ? `${uiRuntime.url}/mf-manifest.json` : "/mf-manifest.json",
      publicUrl: typeof uiConfig.publicUrl === "string" ? uiConfig.publicUrl : undefined,
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
      dependsOn: apiConfig.dependsOn ? normalizeStringArray(apiConfig.dependsOn) : undefined,
    },
    auth: authEntry,
    plugins: Object.keys(runtimePlugins).length > 0 ? runtimePlugins : undefined,
  };

  yield* Effect.tryPromise({
    try: async () => {
      // catch-all diagnostics: a failed discovery fetch degrades to a
      // warning, never fails the runtime config build
      try {
        if (result.api.source !== "remote" || !result.api.url) return;
        const manifest = await fetchApiPluginManifest(result.api.url);
        const manifestPluginEntries: Array<{ key: string; config: RuntimePluginConfig }> = [];
        if (manifest.plugins?.length) {
          for (const node of manifestPluginsToNodes(manifest.plugins)) {
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
                  if (!getProcessEnv(secretName)) {
                    warnOutsideEffect(
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
        if (manifestPluginEntries.length > 0) {
          if (!result.plugins) result.plugins = {};
          for (const { key, config: pluginConfig } of manifestPluginEntries) {
            if (!result.plugins[key]) {
              result.plugins[key] = pluginConfig;
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnOutsideEffect(`[Config] Failed to fetch API plugin manifest for discovery: ${message}`);
      }
    },
    catch: (cause) => new ConfigExtendsError({ message: String(cause), cause }),
  });

  yield* Effect.tryPromise({
    try: () => deriveVersionManifestFields(result, config, env),
    catch: (cause) => new ConfigVersionManifestError({ message: String(cause), cause }),
  });

  return result;
});

/**
 * Version-manifest derivation (atomic-deploys 04): for every remote slot,
 * resolve its `pin` (fetch + SRI-verify the pinned manifest, process-cached
 * per pin) and stamp the derived entry-level fields — `entryUrl` (hashed
 * container entry), the browser-manifest `entry`, and entry-level
 * `integrity`/`ssrIntegrity`/`ssrEntryUrl` — so consumers load immutable
 * hashed bytes without knowing the pointer indirection.
 *
 * Hard break: outside development every remote slot MUST pin a version
 * manifest — an unpinned remote slot fails resolution loudly (the deploy
 * train pins every workspace it uploads; a manifest-less slot means a
 * pre-atomic-deploy config).
 */
async function deriveVersionManifestFields(
  result: RuntimeConfig,
  config: BosConfig,
  env: BosEnv,
): Promise<void> {
  if (env === "development") return;

  const derive = async (
    label: string,
    slotConfig: { pin?: unknown } | undefined,
    slot: { url?: string; remoteUrl?: string; source?: string } | undefined,
    apply: (resolved: ResolvedSlotVersion) => void,
  ): Promise<void> => {
    if (!slot || slot.source !== "remote" || !slot.url) return;
    // A config without a production form (a dev resolution materialized
    // under NODE_ENV=production) has no deployment artifacts to pin — the
    // slot URL is the local listening fallback. Pin enforcement is for
    // published configs.
    const slotWithProduction = slotConfig as { production?: unknown } | undefined;
    if (!slotWithProduction || slotWithProduction.production === undefined) return;
    const rawPin = slotConfig?.pin as { manifest?: unknown; integrity?: unknown } | undefined;
    const pin =
      rawPin &&
      typeof rawPin.manifest === "string" &&
      rawPin.manifest &&
      typeof rawPin.integrity === "string" &&
      rawPin.integrity
        ? { manifest: rawPin.manifest, integrity: rawPin.integrity }
        : undefined;
    if (!pin) {
      throw new Error(
        `slot "${label}" (${slot.url}) pins no version manifest — remote slots must pin ` +
          `a version manifest outside development (pre-atomic-deploy config; redeploy required)`,
      );
    }
    // The pin resolves against the slot's REMOTE base — the host slot's `url`
    // is its own listening origin (the bytes it would serve don't exist
    // there); its `remoteUrl` carries the deployment bundle base.
    const resolved = await resolveSlotVersion({ base: slot.remoteUrl ?? slot.url, pin });
    apply(resolved);
  };

  const applyUi = (ui: RuntimePluginConfig["ui"], r: ResolvedSlotVersion): void => {
    if (!ui) return;
    ui.entryUrl = r.entryUrl;
    ui.entry = r.browserManifestUrl ?? ui.entry;
    ui.browserManifestUrl = r.browserManifestUrl;
    ui.integrity = r.entryIntegrity;
    ui.ssrEntryUrl = r.ssrEntryUrl;
    ui.ssrIntegrity = r.ssrIntegrity ?? ui.ssrIntegrity;
  };

  await derive("app.host", config.app.host, result.host, (r) => {
    result.host.entryUrl = r.entryUrl;
    result.host.integrity = r.entryIntegrity;
  });
  await derive("app.ui", config.app.ui, result.ui, (r) => applyUi(result.ui, r));
  await derive("app.api", config.app.api, result.api, (r) => {
    result.api.entryUrl = r.entryUrl;
    result.api.integrity = r.entryIntegrity;
  });
  if (result.auth) {
    await derive("app.auth", config.app.auth, result.auth, (r) => {
      result.auth!.entryUrl = r.entryUrl;
      result.auth!.integrity = r.entryIntegrity;
    });
    await derive(
      "app.auth.ui",
      getEntryAssociatedUi(config.app.auth as Partial<BosPluginRef>),
      result.auth.ui,
      (r) => applyUi(result.auth!.ui, r),
    );
  }
  for (const [key, plugin] of Object.entries(result.plugins ?? {})) {
    let pluginConfig = config.plugins?.[key];
    // The auth mirror (config.ts adds plugins.auth when the authored config
    // has no plugins.auth entry) derives from the app.auth slot — it is the
    // only compose surface for the auth ui, and its pins live on app.auth.
    const isAuthMirror =
      key === "auth" && result.auth && (plugin === result.auth || plugin.url === result.auth.url);
    if ((!pluginConfig || typeof pluginConfig === "string") && isAuthMirror) {
      pluginConfig = config.app.auth;
    }
    if (!pluginConfig || typeof pluginConfig === "string") continue;
    await derive(`plugins.${key}`, pluginConfig, plugin, (r) => {
      plugin.entryUrl = r.entryUrl;
      plugin.integrity = r.entryIntegrity;
    });
    await derive(
      `plugins.${key}.ui`,
      getEntryAssociatedUi(pluginConfig as Partial<BosPluginRef>),
      plugin.ui,
      (r) => applyUi(plugin.ui, r),
    );
  }
}

export async function buildRuntimeConfig(
  config: BosConfig,
  baseDir: string,
  env: BosEnv,
  options?: BuildRuntimeConfigOptions,
): Promise<RuntimeConfig> {
  return Effect.runPromise(buildRuntimeConfigEffect(config, baseDir, env, options));
}

type PluginOverrideValue = PluginEntryValue | null | false;

function normalizePluginEntry(raw: PluginOverrideValue): BosPluginRef | null | false {
  if (raw === null || raw === false) return raw;
  if (typeof raw === "string") {
    return { extends: raw };
  }
  return raw;
}

const resolveRuntimePluginsEffect = Effect.fn("resolveRuntimePlugins")(function* (
  plugins: Record<string, PluginOverrideValue>,
  baseDir: string,
  env: BosEnv,
  remotePlugins?: string[],
): Effect.fn.Return<Record<string, RuntimePluginConfig>, ConfigExtendsError> {
  const entries = Object.entries(plugins)
    .map(([pluginId, rawInput]) => ({
      pluginId,
      normalized: normalizePluginEntry(rawInput),
    }))
    .filter(
      (entry): entry is { pluginId: string; normalized: BosPluginRef } =>
        entry.normalized !== null && entry.normalized !== false,
    );

  const resolved = yield* Effect.forEach(
    entries,
    ({ pluginId, normalized }) =>
      Effect.gen(function* () {
        const resolvedReference = yield* Effect.tryPromise({
          try: () => resolveComposableReference(normalized, baseDir, env, `plugins.${pluginId}`),
          catch: (cause) => new ConfigExtendsError({ message: String(cause), cause }),
        });

        const forceSource =
          remotePlugins === undefined
            ? undefined
            : remotePlugins.length === 0 || remotePlugins.includes(pluginId)
              ? ("remote" as const)
              : undefined;
        const pluginRuntime = buildRuntimePluginConfig(
          pluginId,
          env,
          resolvedReference,
          forceSource,
        );

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
          pluginRuntime.name = yield* Effect.tryPromise({
            try: () => resolveRemotePluginRuntimeName(pluginRuntime.url, pluginRuntime.name),
            catch: (cause) => new ConfigExtendsError({ message: String(cause), cause }),
          });
        }

        return [pluginId, pluginRuntime] as const;
      }),
    { concurrency: "unbounded" },
  );

  const out: Record<string, RuntimePluginConfig> = {};
  for (const entry of resolved) {
    if (entry) {
      out[entry[0]] = entry[1];
    }
  }

  return out;
});

function resolveRuntimePlugins(
  plugins: Record<string, PluginOverrideValue>,
  baseDir: string,
  env: BosEnv,
  remotePlugins?: string[],
): Promise<Record<string, RuntimePluginConfig>> {
  return Effect.runPromise(resolveRuntimePluginsEffect(plugins, baseDir, env, remotePlugins));
}

async function resolveRemotePluginRuntimeName(baseUrl: string, fallback: string): Promise<string> {
  const manifest = await fetchJsonOrNull<{
    plugin?: { name?: unknown };
  }>(`${baseUrl.replace(/\/$/, "")}/plugin.manifest.json`, { retries: 2 });

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
    throw new ConfigExtendsError({
      message: `Plugin "${pluginId}" has unsupported production target "${production}". Use extends: "bos://account/domain" for plugin configs or a CDN URL for production.`,
    });
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

  const ui = buildRuntimeUiConfig(
    pluginId,
    env,
    resolved.associatedUi,
    resolved.providerBaseDir,
    apiName,
    forceSource,
  );

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
    connectSrc: normalizeStringArray(source.connectSrc),
    integrity: runtimeTarget.source === "remote" ? source.integrity : undefined,
    ui,
    routes,
    dependsOn: source.dependsOn ? normalizeStringArray(source.dependsOn) : undefined,
  };
}

/**
 * Resolve a plugin entry's associated ui surface (`plugins.<id>.ui` / legacy
 * `plugins.<id>.app.ui`) into the runtime ui config. Extracted so app-slot
 * entries (app.auth) resolve their ui the same way.
 */
function buildRuntimeUiConfig(
  pluginId: string,
  env: BosEnv,
  uiConfig: Record<string, unknown> | undefined,
  providerBaseDir: string,
  apiName: string,
  forceSource?: "local" | "remote",
): RuntimePluginConfig["ui"] {
  const uiDevelopment =
    typeof uiConfig?.development === "string" ? uiConfig.development : undefined;
  const uiProduction = typeof uiConfig?.production === "string" ? uiConfig.production : undefined;
  const uiRuntime =
    uiConfig && (uiDevelopment || uiProduction)
      ? env === "development"
        ? resolveDevelopmentTarget(
            uiDevelopment,
            uiProduction,
            providerBaseDir,
            forceSource,
            `plugins.${pluginId}.ui`,
          )
        : resolveRuntimeTarget(uiProduction, providerBaseDir, "remote")
      : undefined;
  if (!uiRuntime) return undefined;
  // A remote ui target with no URL is not a deployable surface (e.g. a
  // plugin ui entry with only a development key) — dropping it here keeps
  // the phantom source out of runtime resolution and client payloads.
  if (uiRuntime.source === "remote" && !uiRuntime.url) return undefined;

  return {
    name: resolveUiRuntimeName(uiConfig, uiRuntime.localPath, apiName),
    url: uiRuntime.url,
    entry: uiRuntime.url
      ? `${uiRuntime.url.replace(/\/$/, "")}/mf-manifest.json`
      : "/mf-manifest.json",
    source: uiRuntime.source,
    publicUrl: typeof uiConfig?.publicUrl === "string" ? uiConfig.publicUrl : undefined,
    localPath: uiRuntime.localPath,
    port: uiRuntime.port,
    integrity:
      uiRuntime.source === "remote" && typeof uiConfig?.integrity === "string"
        ? uiConfig.integrity
        : undefined,
    ssrUrl:
      uiRuntime.source === "remote" && typeof uiConfig?.ssr === "string"
        ? uiConfig.ssr
        : uiRuntime.source === "local"
          ? uiRuntime.url
          : undefined,
    ssrIntegrity:
      uiRuntime.source === "remote" && typeof uiConfig?.ssrIntegrity === "string"
        ? uiConfig.ssrIntegrity
        : undefined,
  };
}

/**
 * MF container identity must match the build: folder-form plugin ui sources
 * build under the sanitized plugin workspace package name (the generated
 * rsbuild config imports the plugin's package.json), so derive the same
 * value here — an authored `ui.name` is only a fallback, and can never
 * override what the container actually registers under.
 */
export function resolveUiRuntimeName(
  uiConfig: Record<string, unknown> | undefined,
  localPath: string | undefined,
  apiName: string,
): string {
  if (localPath) {
    const uiPkgPath = join(localPath, "package.json");
    const pkgPath = existsSync(uiPkgPath) ? uiPkgPath : join(dirname(localPath), "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: unknown };
      if (typeof pkg.name === "string" && pkg.name.length > 0) {
        return sanitizeContainerName(pkg.name);
      }
    } catch (e) {
      console.warn(`[Config] Could not read package.json at ${pkgPath}: ${String(e)}`);
    }
  }
  return typeof uiConfig?.name === "string" ? uiConfig.name : `${apiName}-ui`;
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
    console.warn(`[Config] Could not read package.json at ${localPath}: ${String(e)}`);
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
      throw new ConfigExtendsError({ message: `Invalid local development target: ${value}` });
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
