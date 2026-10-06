import { createInstance, getInstance } from "@module-federation/enhanced/runtime";
import { setGlobalFederationInstance } from "@module-federation/runtime-core";
import { Config, Context, Data, Effect, Layer, Option, Redacted } from "effect";
import { createPluginRuntime } from "every-plugin";
import type { PluginLoadFailureInfo } from "every-plugin/errors";
import { classifyPluginFailure, PluginRuntimeError } from "every-plugin/errors";
import { loadRemoteWithRetry } from "every-plugin/remote-entry";
import {
  type HostSharedEntry,
  mergeSharedMaps,
  type SharedDependencyConfig,
  toHostSharedEntry,
} from "every-plugin/shared-deps-spec";
import type { BosEnv } from "everything-dev/config";
import { buildDependencyDAG, getDependenciesForNode, getSingletonKey } from "everything-dev/dag";
import { IntegrityRegistry, verifyConfigAgainstChain } from "everything-dev/integrity";
import { installIntegrityFetchHook } from "everything-dev/mf";
import type { RuntimeConfig, RuntimePluginConfig, SharedConfig } from "everything-dev/types";
import { type EntrySlot, entryUrls } from "everything-dev/ui/manifest";
import type { RuntimePlugin } from "../types";
import { logger } from "../utils/logger";
import { maskDbUrl } from "../utils/mask-db-url";
import { toProtocolUrl } from "../utils/normalize";
import { ConfigService, readCorsOrigins } from "./config";
import { PluginError } from "./errors";

class PluginBootstrapError extends Data.TaggedError("PluginBootstrapError")<{
  pluginKey: string;
  pluginUrl?: string;
  stage: "load" | "init" | "db-preflight" | "db-migration";
  dbSecret?: string;
  dbUrlMasked?: string;
  execution: "local-host-process";
  cause: unknown;
}> {
  /**
   * The failing runtime stage, when the cause is a stage-attributed
   * `PluginRuntimeError` ("register-remote" | "load-remote" | ... |
   * "initialize-plugin") — otherwise undefined.
   */
  get operation(): string | undefined {
    return this.cause instanceof PluginRuntimeError ? this.cause.operation : undefined;
  }

  /** classification of the underlying cause (kind / retryable / suggestion) */
  get classification() {
    return classifyPluginFailure(this.cause);
  }

  get message() {
    const classification = this.classification;
    const detail = classification.suggestion
      ? `${classification.message} (${classification.kind}) → ${classification.suggestion}`
      : classification.message;
    return `Plugin ${this.pluginKey}${this.pluginUrl ? ` at ${this.pluginUrl}` : ""} failed: ${detail}`;
  }
}

/** Structured per-plugin failure surfaced through health endpoints. */
export type PluginFailureInfo = PluginLoadFailureInfo;

function dbUrlSummary(url: string | undefined): string {
  if (!url || url === "unset") return "unset";
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}/${u.pathname.split("/").filter(Boolean).pop() || "?"}`;
  } catch {
    return maskDbUrl(url);
  }
}

/**
 * The slot the federation runtime registers and loads a remote from —
 * resolution errors name the CONFIG KEY (e.g. "plugins.apps"), not the MF
 * container name.
 */
const pluginSlot = (config: RuntimePluginConfig, key: string): EntrySlot => ({
  ...config,
  name: key,
});

export interface InitializedPluginResult {
  effectContext: unknown;
  plugin?: { servicesTag?: unknown; id?: string };
  [key: string]: unknown;
}

export interface HostPluginEntry {
  key: string;
  name: string;
  createClient: (context?: unknown) => unknown;
  router: unknown;
  metadata: { remoteUrl: string; version?: string };
  initialized?: InitializedPluginResult;
}

/**
 * Sibling plugin entry passed to dependent plugins' initialize/createRouter.
 * Mirrors `PluginServicesEntry` from every-plugin: `client` creates an
 * in-process typed client, `router` is the raw router for merging.
 */
export interface PluginsClientEntry {
  client: (context?: unknown) => unknown;
  router: unknown;
}

export function failedPluginsClientEntry(message: string): PluginsClientEntry {
  return {
    client: () => {
      throw new Error(message);
    },
    router: new Proxy(
      {},
      {
        get() {
          throw new Error(message);
        },
      },
    ),
  };
}

export interface PluginStatus {
  available: boolean;
  pluginName: string | null;
  error: string | null;
  errorDetails: string | null;
  loadedPlugins: string[];
  /** structured per-plugin failures (empty when all plugins loaded) */
  failures: PluginFailureInfo[];
}

export interface PluginResult {
  runtime: ReturnType<typeof createPluginRuntime> | null;
  auth: HostPluginEntry | null;
  api: HostPluginEntry | null;
  plugins: Record<string, HostPluginEntry>;
  authClient: ((ctx?: unknown) => unknown) | null;
  status: PluginStatus;
}

export function secretsFromEnv(
  keys: string[],
): Effect.Effect<Record<string, Redacted.Redacted<string>>, Config.ConfigError> {
  return Effect.gen(function* () {
    const out: Record<string, Redacted.Redacted<string>> = {};
    for (const key of keys) {
      const value = yield* Config.Redacted(key).pipe(Config.option);
      if (Option.isSome(value) && Redacted.value(value.value).length > 0) {
        out[key] = value.value;
      }
    }
    return out;
  });
}

/**
 * Plugin `*_DATABASE_URL` secrets fall back to the shared API database — the
 * platform's two-database contract (`AUTH_DATABASE_URL` + `API_DATABASE_URL`
 * only; plugins isolate their tables in `plugin_<slug>` schemas). Explicit
 * per-plugin values always win.
 */
export function resolveSecretsWithDatabaseFallback(
  keys: string[],
): Effect.Effect<Record<string, string>, Config.ConfigError> {
  return Effect.gen(function* () {
    const secrets = unredactSecrets(yield* secretsFromEnv(keys));
    const missingDbKeys = keys.filter((k) => k.endsWith("_DATABASE_URL") && !secrets[k]);
    if (missingDbKeys.length === 0) return secrets;

    const apiDbUrl = yield* Config.Redacted("API_DATABASE_URL").pipe(Config.option);
    if (Option.isNone(apiDbUrl)) return secrets;
    const fallback = Redacted.value(apiDbUrl.value);
    if (fallback.length === 0) return secrets;

    for (const key of missingDbKeys) secrets[key] = fallback;
    return secrets;
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    let msg = error.message || error.name || "Error";
    if (error.cause instanceof Error) {
      msg += ` (caused by: ${error.cause.message || error.cause.name})`;
    } else if (error.cause) {
      msg += ` (caused by: ${String(error.cause)})`;
    }
    return msg;
  }
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;
    if (err.message) return String(err.message);
    if (err._tag) return `[${err._tag}] ${JSON.stringify(error)}`;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Normalized, version-validated registration entries (minus `get`) for the
 * Module Federation runtime — derived from the SharedDependencySpec's
 * normalization policy, so config-declared shared deps cannot enter the
 * runtime with an unresolved version ("*"/"latest") or drifted defaults.
 */
export function buildSharedRegistrationEntries(
  appShared: Record<string, SharedDependencyConfig> | undefined,
): Record<string, HostSharedEntry> {
  if (!appShared || Object.keys(appShared).length === 0) return {};
  return Object.fromEntries(
    Object.entries(appShared).map(([name, config]) => [name, toHostSharedEntry(name, config)]),
  );
}

/**
 * Pre-registers app-specific shared dependencies in the Module Federation runtime.
 * This runs in the host scope before every-plugin initializes its own core-only MF instance.
 */
async function registerAppSharedDeps(
  appShared: Record<string, SharedDependencyConfig> | undefined,
): Promise<void> {
  const normalizedEntries = buildSharedRegistrationEntries(appShared);
  if (Object.keys(normalizedEntries).length === 0) return;

  const sharedEntries: Record<string, HostSharedEntry & { get: () => Promise<() => unknown> }> = {};

  for (const [name, entry] of Object.entries(normalizedEntries)) {
    try {
      // Import from host scope — this is where app-specific deps are installed
      const mod = await import(/* webpackIgnore: true */ name);
      sharedEntries[name] = { ...entry, get: () => Promise.resolve(() => mod) };
    } catch (error) {
      logger.error(`[Plugins] Failed to preload shared dependency ${name}: ${formatError(error)}`);
      throw new Error(
        `Shared dependency "${name}" is configured in bos.config.json but could not be resolved. ` +
          `Ensure it is installed in the host workspace.`,
      );
    }
  }

  let instance = getInstance();
  if (!instance) {
    instance = createInstance({
      name: "host",
      remotes: [],
      shared: sharedEntries,
    });
    setGlobalFederationInstance(instance);
    logger.info(
      `[Plugins] Pre-registered ${Object.keys(sharedEntries).length} app-specific shared dep(s)`,
    );
  } else {
    instance.registerShared(sharedEntries);
    logger.info(
      `[Plugins] Augmented existing MF instance with ${Object.keys(sharedEntries).length} app-specific shared dep(s)`,
    );
  }
}

const unavailableResult = (
  pluginName: string | null,
  error: string | null,
  errorDetails: string | null,
  loadedPlugins: string[] = [],
  failures: PluginFailureInfo[] = [],
): PluginResult => ({
  runtime: null,
  auth: null,
  api: null,
  plugins: {},
  authClient: null,
  status: { available: false, pluginName, error, errorDetails, loadedPlugins, failures },
});

interface RuntimePluginEntry {
  key: string;
  runtimeId: string;
  config: RuntimeConfig["api"] | RuntimePlugin;
}

function unredactSecrets(
  secrets: Record<string, Redacted.Redacted<string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(secrets).map(([key, value]) => [key, Redacted.value(value)]),
  );
}

/** An origin string is a usable BASE_URL override only when it parses as an
 * http(s) URL — anything else (vitest's "/" base, missing scheme, blank)
 * falls through to the next candidate in the precedence chain. */
function asOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed);
    return url.origin === "null" ? undefined : `${url.origin}`;
  } catch {
    return undefined;
  }
}

export function buildAuthBaseVariables(
  config: RuntimeConfig,
  corsOrigins: string[],
): Effect.Effect<Record<string, unknown>> {
  return Effect.gen(function* () {
    const rawHostUrl =
      config.env === "development"
        ? (config.host?.url ?? `http://localhost:${config.host?.port ?? 3000}`)
        : config.domain;
    const hostUrl = toProtocolUrl(rawHostUrl, config.env);

    // Reachable-origin precedence: BASE_URL env (the deployment context —
    // generated by `bos dev` infra planning, injected by the regression
    // container harness) beats the authored config variable, which beats the
    // derivation from the bos config. Without any of them the plugin's
    // parseTrustedOrigins owns the localhost:3000 fallback. A BASE_URL value
    // that is not a usable origin is ignored (vitest sets "/" as its Vite
    // base; an operator typo must not take the auth origin down).
    const envRaw = yield* Config.String("BASE_URL").pipe(
      Config.withDefault(""),
      Config.map((value) => value.trim() || undefined),
      Effect.orElseSucceed(() => undefined),
    );
    const envBaseUrl = asOrigin(envRaw);
    if (envRaw && !envBaseUrl) {
      yield* Effect.logWarning(
        `[Auth] Ignoring BASE_URL="${envRaw}" — not an http(s) origin; using the derived origin.`,
      );
    }
    const authVariables = config.auth?.variables;
    const authoredBaseUrl = asOrigin(
      typeof authVariables?.baseUrl === "string" ? authVariables.baseUrl : undefined,
    );
    const baseUrl = envBaseUrl ?? authoredBaseUrl ?? hostUrl;

    const base: Record<string, unknown> = {
      account: config.account,
      domain: hostUrl,
      hostUrl,
      // The plugin's Better Auth baseURL — invite-email links, passkey RP-id
      // derivation, and callback URLs all derive from it.
      baseUrl,
    };
    if (corsOrigins.length > 0) {
      base.trustedOrigins = corsOrigins;
    }

    // Origin truth: an empty baseUrl in production is a misconfiguration —
    // fail loud rather than masquerading as localhost. In development the
    // empty case is deliberate: the auth plugin's parseTrustedOrigins owns
    // the localhost:3000 fallback (pinned by auth-base-variables.test.ts).
    const originSource = baseUrl || hostUrl;
    if (!originSource && config.env !== "development") {
      throw new Error(
        "[Auth] No reachable origin — BASE_URL, the authored baseUrl, and the host url are all unset. Set BASE_URL or the config domain; Better Auth cannot derive its own origin in production.",
      );
    }
    const effectiveOrigin = originSource ? new URL(originSource).origin : "http://localhost:3000";
    yield* Effect.logInfo(
      `[Auth] Better Auth origin: ${effectiveOrigin}${baseUrl === envBaseUrl && envBaseUrl ? " (BASE_URL)" : ""}${corsOrigins.length > 0 ? ` · trustedOrigins: ${corsOrigins.join(", ")}` : " · trustedOrigins: (none — only baseURL trusted)"}`,
    );

    if (hostUrl) {
      const hostOrigin = new URL(hostUrl).origin;
      if (
        corsOrigins.length > 0 &&
        !corsOrigins.some((origin) => new URL(origin).origin === hostOrigin)
      ) {
        yield* Effect.logWarning(
          `[Auth] CORS_ORIGIN (${corsOrigins.join(", ")}) does not include the host origin ${hostOrigin}. Sign-in may fail after login redirects — fix CORS_ORIGIN in .env or let bos dev regenerate it.`,
        );
      }
    }

    return base;
  });
}

function logBootstrapError(err: PluginBootstrapError): Effect.Effect<void> {
  return Effect.gen(function* () {
    const operation = err.operation ? ` (${err.operation})` : "";
    const retryable = err.classification.retryable ? "retryable" : "permanent";
    yield* Effect.logError(
      `[Plugins][${err.pluginKey}] Failed to load plugin${operation} — ${retryable}: ${err.message}`,
    );
    if (err.dbSecret) {
      if (err.dbUrlMasked) {
        const dbLabel =
          err.pluginKey === "auth"
            ? "Auth"
            : err.pluginKey === "api"
              ? "API"
              : `${err.pluginKey} (${err.dbSecret})`;
        yield* Effect.logError(
          `[Plugins][${err.pluginKey}] ${dbLabel} DB URL: ${err.dbUrlMasked} (${dbUrlSummary(err.dbUrlMasked)})`,
        );
      }
      if (err.stage === "init") {
        yield* Effect.logError(
          `[Plugins][${err.pluginKey}] Set ${err.dbSecret} in your .env file or ensure local postgres is running for ${err.pluginKey} plugin initialization`,
        );
      }
    }
  });
}

function loadPluginEntryEffect(
  runtime: any,
  entry: RuntimePluginEntry,
  integrityRegistry: IntegrityRegistry,
  env: BosEnv,
  pluginsClient?: Record<string, unknown>,
  baseVariables?: Record<string, unknown>,
): Effect.Effect<HostPluginEntry, PluginBootstrapError | Config.ConfigError> {
  return Effect.gen(function* () {
    if (entry.config.integrity) {
      integrityRegistry.registerEntry(entry.config.url, entry.config.integrity);
    }

    const isAuthOrApi = entry.key === "auth" || entry.key === "api";
    const pluginDbSecretKey = isAuthOrApi
      ? null
      : ((entry.config.secrets ?? []).find((k) => k.endsWith("_DATABASE_URL")) ?? null);
    const secretKey = isAuthOrApi
      ? entry.key === "auth"
        ? "AUTH_DATABASE_URL"
        : "API_DATABASE_URL"
      : pluginDbSecretKey;

    const variables: Record<string, unknown> = { ...baseVariables, ...entry.config.variables };
    const secrets = yield* resolveSecretsWithDatabaseFallback(entry.config.secrets ?? []);
    const dbSecret = secretKey
      ? secrets[secretKey]
        ? Redacted.make(secrets[secretKey])
        : null
      : null;
    const args: [unknown, unknown?] = [{ variables, secrets }];
    if (pluginsClient) args.push(pluginsClient);

    const remoteUrl = entryUrls(pluginSlot(entry.config, entry.key), env).web;
    const result = yield* loadRemoteWithRetry<Omit<HostPluginEntry, "key" | "name">>({
      label: entry.key,
      remoteUrl,
      load: () => runtime.usePlugin(entry.runtimeId, ...args),
    }).pipe(
      Effect.mapError((error) => {
        if (dbSecret !== null && secretKey) {
          return new PluginBootstrapError({
            pluginKey: entry.key,
            pluginUrl: entry.config.url,
            stage: "db-migration",
            dbSecret: secretKey,
            dbUrlMasked: maskDbUrl(Redacted.value(dbSecret)),
            execution: "local-host-process",
            cause: error,
          });
        }
        return new PluginBootstrapError({
          pluginKey: entry.key,
          pluginUrl: entry.config?.url ?? "unknown",
          stage: "init",
          execution: "local-host-process",
          cause: error,
        });
      }),
    );

    return { key: entry.key, name: entry.config.name, ...result };
  });
}

export const initializePlugins = Effect.gen(function* () {
  const config: RuntimeConfig = yield* ConfigService;

  if (config.api.proxy) {
    yield* Effect.logInfo(`[Plugins] Proxy mode enabled, skipping plugin initialization`);
    yield* Effect.logInfo(`[Plugins] API requests will be proxied to: ${config.api.proxy}`);
    return {
      runtime: null,
      auth: null,
      api: null,
      plugins: {},
      authClient: null,
      status: {
        available: false,
        pluginName: config.api.name,
        error: null,
        errorDetails: null,
        loadedPlugins: [],
        failures: [],
      },
    } satisfies PluginResult;
  }

  const dag = buildDependencyDAG(config);

  const entryMap = new Map<string, RuntimePluginEntry>();
  if (config.auth?.url) {
    entryMap.set("auth", { key: "auth", runtimeId: config.auth.name, config: config.auth });
  }
  if (config.api?.url) {
    entryMap.set("api", { key: "api", runtimeId: config.api.name, config: config.api });
  }
  for (const [key, plugin] of Object.entries(config.plugins ?? {})) {
    if (!plugin.url) continue;
    if (
      key === "auth" &&
      config.auth &&
      (plugin === config.auth ||
        (plugin.localPath && plugin.localPath === config.auth.localPath) ||
        (!plugin.localPath && plugin.source === "remote" && plugin.url === config.auth.url))
    ) {
      continue;
    }
    entryMap.set(key, { key, runtimeId: plugin.name, config: plugin });
  }

  const loadableEntries = [...dag.sorted].filter((k) => entryMap.has(k));
  if (loadableEntries.length === 0 && !config.auth) {
    yield* Effect.logInfo("[Plugins] No remote plugins configured, using host API only");
    return unavailableResult(config.api.name, null, null);
  }

  yield* Effect.logInfo(
    `[Plugins] Loading ${loadableEntries.length} plugin(s) in DAG order: ${loadableEntries.join(" → ")}`,
  );

  if (config.env === "production" && config.account) {
    const bosUrl = `bos://${config.account}/${config.domain ?? "everything.dev"}`;
    // Scope-owned: the fiber lives with the plugins service — an abandoned
    // attestation used to float outside any fiber's lifetime.
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        const { verified, mismatches } = yield* Effect.tryPromise({
          try: () => verifyConfigAgainstChain(config as unknown as Record<string, unknown>, bosUrl),
          catch: (cause) => new PluginError({ pluginName: "config attestation", cause }),
        });
        if (!verified) {
          logger.error(
            `[Attestation] Config integrity does not match on-chain anchor. Mismatches: ${mismatches.join(", ")}`,
          );
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            logger.warn("[Attestation] On-chain config check failed", { cause: error }),
          ),
        ),
      ),
    );
  }

  const corsOrigins = yield* readCorsOrigins;

  const { runtime, integrityRegistry } = yield* Effect.tryPromise({
    try: async () => {
      const allEntries = [...entryMap.values()];

      const integrityRegistry = new IntegrityRegistry();

      logger.info(
        `[Plugins] Registry entries: ${allEntries.map((e) => `${e.key}=${e.config.url}`).join(", ") || "none"}`,
      );

      const pluginSharedMaps = Object.values(config.plugins ?? {})
        .map((plugin) => plugin.shared)
        .filter((shared): shared is Record<string, SharedConfig> =>
          Boolean(shared && Object.keys(shared).length > 0),
        );

      await registerAppSharedDeps(
        mergeSharedMaps(config.api.shared, config.auth?.shared, ...pluginSharedMaps),
      );

      const runtime = createPluginRuntime({
        registry: Object.fromEntries(
          allEntries.map((entry) => {
            const remoteUrl = entryUrls(pluginSlot(entry.config, entry.key), config.env).web;
            return [entry.runtimeId, { remote: remoteUrl }];
          }),
        ),
        secrets: {},
      });

      const mfInstance = (runtime as any).__mfInstance as any | undefined;
      if (mfInstance) {
        installIntegrityFetchHook(mfInstance, integrityRegistry);
      }

      return { runtime, integrityRegistry };
    },
    catch: (error) =>
      new PluginError({
        pluginName: config.api.name,
        pluginUrl: config.api.url,
        cause: error,
      }),
  });

  const errors: string[] = [];
  const failures: PluginFailureInfo[] = [];
  const loadedPlugins: Record<string, HostPluginEntry> = {};
  const loadedPluginKeys: string[] = [];
  const pluginsClient: Record<string, unknown> = {};
  const singletonCache = new Map<string, HostPluginEntry>();
  let authPlugin: HostPluginEntry | null = null;
  let authClient: ((ctx?: unknown) => unknown) | null = null;
  let baseApi: HostPluginEntry | null = null;

  for (const key of loadableEntries) {
    const entry = entryMap.get(key)!;
    const node = dag.nodes.get(key)!;

    const sKey = getSingletonKey(node);
    const cached = singletonCache.get(sKey);
    if (cached) {
      yield* Effect.logInfo(`[Plugins] Reusing singleton ${key} from ${cached.key}`);
      loadedPlugins[key] = cached;
      loadedPluginKeys.push(key);
      pluginsClient[key] = { client: cached.createClient, router: cached.router };

      if (node.kind === "auth") {
        authPlugin = cached;
        authClient = cached.createClient;
      } else if (node.kind === "api") {
        baseApi = cached;
      }
      continue;
    }

    const deps = getDependenciesForNode(node, dag.nodes);
    const nodePluginsClient: Record<string, unknown> = {};
    for (const dep of deps) {
      if (pluginsClient[dep.key]) {
        nodePluginsClient[dep.key] = pluginsClient[dep.key];
      }
    }

    let baseVariables: Record<string, unknown> | undefined;
    if (node.kind === "auth") {
      baseVariables = yield* buildAuthBaseVariables(config, corsOrigins);
    }

    yield* Effect.logInfo(`[Plugins][${key}] Loading (${entry.config.name})`);

    const result = yield* loadPluginEntryEffect(
      runtime,
      entry,
      integrityRegistry,
      config.env,
      Object.keys(nodePluginsClient).length > 0 ? nodePluginsClient : undefined,
      baseVariables,
    ).pipe(
      Effect.catchTag("PluginBootstrapError", (err: PluginBootstrapError) =>
        Effect.gen(function* () {
          yield* logBootstrapError(err);
          errors.push(err.message);
          failures.push({
            pluginKey: err.pluginKey,
            pluginUrl: err.pluginUrl,
            operation: err.operation,
            kind: err.classification.kind,
            retryable: err.classification.retryable,
            message: err.message,
            suggestion: err.classification.suggestion,
            dbSecret: err.dbSecret,
            dbUrlMasked: err.dbUrlMasked,
          });
          if (node.kind === "plugin") {
            pluginsClient[key] = failedPluginsClientEntry(err.message);
          }
          return null;
        }),
      ),
    );

    if (result) {
      singletonCache.set(sKey, result);
      loadedPlugins[key] = result;
      loadedPluginKeys.push(key);
      pluginsClient[key] = { client: result.createClient, router: result.router };

      if (node.kind === "auth") {
        authPlugin = result;
        authClient = result.createClient;
        yield* Effect.logInfo(`[Plugins][auth] loaded: ${result.name}`);
      } else if (node.kind === "api") {
        baseApi = result;
        yield* Effect.logInfo(`[Plugins][api] loaded: ${result.name}`);
      } else {
        yield* Effect.logInfo(`[Plugins][${key}] loaded`);
      }
    }
  }

  const totalPlugins = Object.values(loadedPlugins).filter(Boolean).length;
  yield* Effect.logInfo(`[Plugins] ${totalPlugins} plugin(s) loaded`);

  if (errors.length > 0) {
    const failedKeys = loadableEntries.filter((key) => !loadedPlugins[key]);
    yield* Effect.logWarning(
      `[Plugins] ⚠ ${errors.length} plugin(s) failed to load — available: ${loadedPluginKeys.join(", ") || "none"}; failed: ${failedKeys.join(", ") || "unknown"}`,
    );
    if (!baseApi) {
      yield* Effect.logWarning(
        "[Plugins] ⚠ Serving without the API: all /api/* routes return 503 and tenant bindings cannot be resolved (tenant-domain SSR and asset proxying fail). Inspect GET /api/_health and the per-plugin errors above.",
      );
    }
  }

  return {
    runtime,
    auth: authPlugin,
    api: baseApi,
    plugins: loadedPlugins,
    authClient,
    status: {
      available: Boolean(baseApi),
      pluginName: config.api.name,
      error: errors.length > 0 ? errors.join("; ") : null,
      errorDetails: errors.length > 0 ? errors.join("\n") : null,
      loadedPlugins: loadedPluginKeys,
      failures,
    },
  } satisfies PluginResult;
}).pipe(
  Effect.catch((error) =>
    Effect.gen(function* () {
      const pluginName = error instanceof PluginError ? error.pluginName : null;
      const pluginUrl = error instanceof PluginError ? error.pluginUrl : null;
      const errorMessage = formatError(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      yield* Effect.logError("[Plugins] ❌ Failed to initialize plugin");
      yield* Effect.logError(`[Plugins] Plugin: ${pluginName}`);
      yield* Effect.logError(`[Plugins] URL: ${pluginUrl}`);
      yield* Effect.logError(`[Plugins] Error: ${errorMessage}`);
      yield* Effect.logWarning("[Plugins] Server will continue without plugin functionality");

      return unavailableResult(pluginName ?? null, errorMessage, errorStack ?? null);
    }),
  ),
);

export class PluginsService extends Context.Service<PluginsService, PluginResult>()(
  "host/PluginsService",
) {
  static Live = Layer.effect(
    PluginsService,
    Effect.gen(function* () {
      const plugins = yield* initializePlugins;

      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          if (plugins.runtime) {
            logger.info("[Plugins] Shutting down plugin runtime...");
            await plugins.runtime.shutdown();
          }
        }),
      );

      return plugins;
    }),
  );
}

export interface PluginsClientOptions {
  /**
   * Per-call deadline for oRPC plugin procedures. A hung plugin call rejects
   * with a named timeout error instead of suspending the caller (an SSR
   * stream) forever. Opt-in: unset means no deadline.
   */
  callTimeoutMs?: number;
}

/**
 * Deadline-wrap every callable leaf of a nested oRPC client (namespaces are
 * plain objects, procedures are functions). The underlying call keeps running
 * after a deadline rejection — in-process, so a stray late settle is
 * harmless; the point is that the CALLER (an SSR route loader) fails fast
 * and the stream closes.
 */
function withCallDeadline(client: unknown, timeoutMs: number, path = "plugin"): unknown {
  if (client === null || typeof client !== "object") return client;
  const wrap = (fn: unknown, key: string) => {
    if (typeof fn !== "function") return fn;
    return (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`[SSR] ${path}.${key}() exceeded ${timeoutMs}ms call deadline`)),
          timeoutMs,
        );
        Promise.resolve(Reflect.apply(fn, target, args)).then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
  };
  const target = client as Record<string, unknown>;
  return new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key === "symbol") return Reflect.get(t, key, receiver);
      const value = Reflect.get(t, key, receiver);
      if (typeof value === "function") return wrap(value, key);
      if (value !== null && typeof value === "object") {
        return withCallDeadline(value, timeoutMs, `${path}.${key}`);
      }
      return value;
    },
  });
}

export function createPluginsClient(
  result: PluginResult,
  context?: unknown,
  options?: PluginsClientOptions,
): unknown {
  const deadline = options?.callTimeoutMs;
  const apiClient = result.api?.createClient(context);
  const scoped = (client: unknown) => (deadline ? withCallDeadline(client, deadline) : client);

  // Do NOT Object.assign the result — apiClient is a Proxy and assign would copy
  // only static own-properties, silently dropping Proxy-resolved RPC methods.

  const pluginClients: Record<string, unknown> = {};
  for (const [key, plugin] of Object.entries(result.plugins)) {
    if (key === "api") continue;
    pluginClients[key] = scoped(plugin.createClient(context));
  }

  if (result.authClient) {
    // The better-auth client surface carries non-call function-valued
    // members (atoms/markers) — leave it unwrapped; deadline only guards
    // oRPC procedure calls.
    pluginClients.auth = result.authClient(context);
  }

  if (!apiClient) {
    return pluginClients;
  }

  return new Proxy(scoped(apiClient) as Record<string, unknown>, {
    get(target, key) {
      if (typeof key === "string" && key in pluginClients) {
        return pluginClients[key];
      }
      return Reflect.get(target, key);
    },
    has(target, key) {
      if (key in pluginClients) return true;
      return Reflect.has(target, key);
    },
  });
}
