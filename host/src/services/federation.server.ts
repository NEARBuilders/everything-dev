import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { createInstance } from "@module-federation/enhanced/runtime";
import { Effect, Schedule, Semaphore } from "effect";
import { verifySriForUrl } from "everything-dev/integrity";
import {
  type ConstructedTree,
  type ConstructInput,
  type RouteConfigModule,
  UI_EXPOSES,
  UI_REMOTE_SERVER_ENTRY_FILENAME,
} from "everything-dev/ui/manifest";
import type { RouterModule } from "../types";
import { logger } from "../utils/logger";
import type { RuntimeConfig } from "./config";
import { ExposeModuleMissing, FederationError } from "./errors";
import { type LocalDistServer, startLocalDistServer } from "./local-dist-server";
import { enforceCacheLimit, pruneExpiredEntries as pruneExpiredCacheEntries } from "./ttl-cache";

export type { RouterModule };

const ROUTER_MODULE_CACHE_TTL_MS = 5 * 60_000;
const SSR_INTEGRITY_CACHE_TTL_MS = 5 * 60_000;
const UI_EXPOSE_CACHE_TTL_MS = 5 * 60_000;
const NEGATIVE_CACHE_TTL_MS = 10_000;
const MAX_ROUTER_MODULE_CACHE_SIZE = 128;
const MAX_SSR_INTEGRITY_CACHE_SIZE = 256;
const MAX_UI_EXPOSE_CACHE_SIZE = 256;

interface CachedPromise<T> {
  expiresAt: number;
  value: Promise<T>;
}

const routerModuleCache = new Map<string, CachedPromise<RouterModule>>();
const verifiedSsrEntryCache = new Map<string, CachedPromise<void>>();
const uiExposeCache = new Map<string, CachedPromise<unknown>>();

type ModuleFederationInstance = ReturnType<typeof createInstance>;

/**
 * SSR composition (core Router + plugin `./tree` exposes) loads through ONE
 * shared MF instance so every remote negotiates singleton shared deps
 * (react, react-dom, @tanstack/*) in the same share scope — separate
 * instances mint separate React copies and composed SSR then crashes with
 * "Invalid hook call / reading 'useContext' of null".
 */
let compositionInstance: ModuleFederationInstance | null = null;
const compositionRemoteEntries = new Map<string, string>();
/** Entry URL each remote was last loaded from — a change means the runtime's
 * moduleCache may hold the previous container, so the next load bypasses it
 * (prevents a mixed-version composed tree after integrity bumps/redeploys). */
const loadedEntryByRemote = new Map<string, string>();

/**
 * Shared share scope for SSR composition. First load creates the instance
 * with its remote; subsequent remotes register onto the same instance.
 * When a remote's ENTRY changes (integrity bump, hot reload), it is
 * re-registered in place — same share scope, fresh remote entry.
 */
function getCompositionInstance(remote: { name: string; entry: string }): ModuleFederationInstance {
  if (!compositionInstance) {
    compositionInstance = createInstance({
      name: "host-ssr-compose",
      remotes: [{ name: remote.name, entry: remote.entry, alias: remote.name }],
    });
    compositionRemoteEntries.clear();
    compositionRemoteEntries.set(remote.name, remote.entry);
    return compositionInstance;
  }

  const registeredEntry = compositionRemoteEntries.get(remote.name);
  if (registeredEntry === remote.entry) {
    return compositionInstance;
  }

  if (registeredEntry !== undefined) {
    removeInstanceRemotes(compositionInstance, remote.name);
  }

  compositionInstance.registerRemotes([
    { name: remote.name, entry: remote.entry, alias: remote.name },
  ]);
  compositionRemoteEntries.set(remote.name, remote.entry);
  return compositionInstance;
}

/**
 * Unregister a remote (or every remote when the name is omitted) through the
 * runtime's remote handler. `registerRemotes` replaces the entry even when
 * removal fails; the worst case is a shallow pin in the runtime's global
 * instance list, which is append-only inside @module-federation.
 */
function removeInstanceRemotes(instance: ModuleFederationInstance, remoteName?: string): void {
  try {
    const handler = (
      instance as unknown as {
        remoteHandler?: { removeRemote?: (remote: unknown) => void };
      }
    ).remoteHandler;
    for (const remote of [...instance.options.remotes]) {
      if (remoteName === undefined || remote.name === remoteName) {
        handler?.removeRemote?.(remote);
      }
    }
  } catch (error) {
    logger.debug(`[Federation] removeRemote(${remoteName ?? "*"}) failed:`, error);
  }
}

/**
 * Activate singleton sharing on the composition instance. Idempotent: the
 * runtime only initializes shares that are not already settled. Must resolve
 * before any expose load so core Router and plugin trees negotiate
 * singletons (react, react-dom, @tanstack/*) in one share scope.
 *
 * Serialized across concurrent expose loads: the runtime's `initializeSharing`
 * is not documented as concurrency-safe, and a settled share scope must exist
 * before ANY expose resolves. The semaphore holds one permit for the whole
 * initialization and releases it on any outcome — each load surfaces its own
 * error.
 */
const shareScopePermits = Semaphore.makeUnsafe(1);

function initializeShareScope(mf: ModuleFederationInstance): Effect.Effect<void, Error> {
  return shareScopePermits.withPermits(1)(
    Effect.tryPromise(() => {
      const sharing = (
        mf as unknown as { initializeSharing?: (scope: string) => unknown }
      ).initializeSharing?.("default");
      if (sharing instanceof Promise) {
        return sharing.then(() => undefined);
      }
      if (Array.isArray(sharing)) {
        return Promise.all(sharing).then(() => undefined);
      }
      return Promise.resolve();
    }),
  );
}

export function resetFederationInstance() {
  routerModuleCache.clear();
  verifiedSsrEntryCache.clear();
  uiExposeCache.clear();
  for (const server of localDistServers.values()) {
    void server.stop();
  }
  localDistServers.clear();
  if (compositionInstance) {
    removeInstanceRemotes(compositionInstance);
  }
  compositionInstance = null;
  compositionRemoteEntries.clear();
  loadedEntryByRemote.clear();
}

const localDistServers = new Map<string, LocalDistServer>();
const LOCAL_CONTAINER_READY_POLL_MS = 300;
const LOCAL_CONTAINER_READY_TIMEOUT_MS = 120_000;

/**
 * Dev-only: a local ui source's built node container, served over loopback so
 * the SAME remote-loading flow as production applies. The container is the
 * rsbuild-built `dist/ssr` bundle — aliases and assets are bundler-resolved,
 * so dev SSR and the client hydrate from identical trees.
 */
export async function localUiRemoteEntry(source: {
  name: string;
  localRoot: string;
}): Promise<UiRemoteEntry> {
  let server = localDistServers.get(source.localRoot);
  if (!server) {
    server = await startLocalDistServer(path.join(source.localRoot, "dist"));
    localDistServers.set(source.localRoot, server);
  }
  const containerPath = path.join(source.localRoot, "dist", "ssr", UI_REMOTE_SERVER_ENTRY_FILENAME);
  const containerVersion = existsSync(containerPath)
    ? String(statSync(containerPath).mtimeMs)
    : "pending";
  return {
    name: source.name,
    localPath: source.localRoot,
    ssrUrl: `${server.baseUrl}/ssr`,
    containerVersion,
  };
}

export async function waitForLocalContainer(entry: UiRemoteEntry): Promise<void> {
  const containerUrl = ssrEntryUrlOf(entry);
  const deadline = Date.now() + LOCAL_CONTAINER_READY_TIMEOUT_MS;
  let announced = false;
  while (Date.now() < deadline) {
    const res = await fetch(containerUrl).catch(() => null);
    const body = await res?.text().catch(() => "");
    if (res?.ok && !/not found|<(!doctype|html)/i.test((body ?? "").slice(0, 64))) return;
    if (!announced) {
      announced = true;
      console.log(`⏳ waiting for ${entry.name} to compile (SSR container not ready)…`);
    }
    await new Promise((resolve) => setTimeout(resolve, LOCAL_CONTAINER_READY_POLL_MS));
  }
  throw new Error(`${entry.name} SSR container never became ready at ${containerUrl}`);
}

export function resolveLocalRoot(localPath: string): string {
  return path.resolve(process.cwd(), localPath);
}

function shouldCacheRouterModule(config: RuntimeConfig) {
  return config.ui.source !== "local" && Boolean(config.ui.ssrIntegrity);
}

async function verifySsrEntryIntegrity(entryUrl: string, expectedIntegrity: string): Promise<void> {
  const cacheKey = `${entryUrl}::${expectedIntegrity}`;
  const now = Date.now();
  pruneExpiredCacheEntries(verifiedSsrEntryCache, now);

  const cached = verifiedSsrEntryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const verification = verifySriForUrl(entryUrl, expectedIntegrity, {
    resolveEntryUrl: false,
  }).catch((error) => {
    verifiedSsrEntryCache.delete(cacheKey);
    throw error;
  });

  verifiedSsrEntryCache.set(cacheKey, {
    value: verification,
    expiresAt: now + SSR_INTEGRITY_CACHE_TTL_MS,
  });
  enforceCacheLimit(verifiedSsrEntryCache, MAX_SSR_INTEGRITY_CACHE_SIZE);
  return verification;
}

function getSsrEntryUrl(config: RuntimeConfig) {
  const ssrUrl = config.ui.ssrUrl;
  if (!ssrUrl) {
    throw new FederationError({
      remoteName: config.ui.name,
      cause: new Error(
        "SSR URL not configured in production. Set app.ui.ssr in bos.config.json to enable SSR.",
      ),
    });
  }

  const entryUrl = `${ssrUrl.replace(/\/$/, "")}/${UI_REMOTE_SERVER_ENTRY_FILENAME}`;
  if (config.ui.ssrIntegrity) {
    return `${entryUrl}?v=${encodeURIComponent(config.ui.ssrIntegrity)}`;
  }

  return entryUrl;
}

const retrySchedule = Schedule.addDelay(Schedule.recurs(5), () => Effect.succeed(500));

interface RemoteModuleLoad<T> {
  cacheKey: string;
  remoteName: string;
  entryUrl: string;
  expose: string;
  cache: Map<string, CachedPromise<T>>;
  ttlMs: number;
  maxSize: number;
  /** the expose's contract: `./Router` default-exports its module object; `./compose`/`./routeConfig` export named members */
  unwrapDefault: boolean;
  /**
   * Evict the runtime's cached container module before loading so an uncached
   * caller (local dev hot reload) always re-executes the expose. Best effort:
   * keyed by remote name on private MF internals, and a failure only leaves a
   * stale module reused in dev. Loads always run through the shared
   * composition instance so singletons stay unified.
   */
  bypassModuleCache: boolean;
}

/**
 * Drop the runtime's cached container module for one remote (see
 * `RemoteModuleLoad.bypassModuleCache`).
 */
function bypassCompositionModuleCache(mf: ModuleFederationInstance, remoteName: string): void {
  try {
    (mf as unknown as { moduleCache?: Map<string, unknown> }).moduleCache?.delete(remoteName);
  } catch (error) {
    logger.debug(`[Federation] bypassCompositionModuleCache(${remoteName}) failed:`, error);
  }
}

/**
 * Load one expose from a remote's server entry: TTL-capped, retry-bounded,
 * negative-cached on failure, served through the SHARED composition instance
 * so core Router and plugin trees negotiate singletons (react, react-dom,
 * @tanstack/*) in one share scope. Failures keep the failing promise cached
 * for NEGATIVE_CACHE_TTL_MS so a downed remote is probed once per window,
 * not once per request.
 */
function loadRemoteExpose<T>(params: RemoteModuleLoad<T>): Promise<T> {
  const {
    cacheKey,
    remoteName,
    expose,
    cache,
    ttlMs,
    maxSize,
    bypassModuleCache,
    entryUrl,
    unwrapDefault,
  } = params;
  const now = Date.now();
  pruneExpiredCacheEntries(cache, now);

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const mf = getCompositionInstance({ name: remoteName, entry: entryUrl });
  const previousEntry = loadedEntryByRemote.get(remoteName);
  const entryChanged = previousEntry !== undefined && previousEntry !== entryUrl;
  if (bypassModuleCache || entryChanged) {
    bypassCompositionModuleCache(mf, remoteName);
  }
  loadedEntryByRemote.set(remoteName, entryUrl);

  const loadEffect = Effect.gen(function* () {
    yield* initializeShareScope(mf);
    const result = yield* Effect.tryPromise({
      try: () => mf.loadRemote<any>(expose, { from: "build" }),
      catch: (e) => e as Error,
    });
    if (!result) {
      return yield* new ExposeModuleMissing({ expose, reason: "not-found" });
    }
    return unwrapDefault
      ? ((result.default as T | undefined) ??
          (yield* new ExposeModuleMissing({ expose, reason: "no-default" })))
      : (result as T);
  }).pipe(Effect.retry(retrySchedule));

  const value = Effect.runPromise(loadEffect);

  cache.set(cacheKey, { value, expiresAt: now + ttlMs });
  enforceCacheLimit(cache, maxSize);

  value.catch(() => {
    const current = cache.get(cacheKey);
    if (current?.value === value) {
      cache.set(cacheKey, { value, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
    }
  });

  return value;
}

/**
 * A ui source's deployment identity on the SSR side: the MF container name
 * plus its server entry. Local dev sources import from disk instead.
 */
export interface UiRemoteEntry {
  name: string;
  ssrUrl?: string;
  ssrIntegrity?: string;
  /** Source workspace of the ui surface (local dev target only). */
  localPath?: string;
  /** Dev-only freshness token — the built container's mtime. Cache-busts rebuilds. */
  containerVersion?: string;
}

function ssrEntryUrlOf(entry: UiRemoteEntry): string {
  if (!entry.ssrUrl) {
    throw new FederationError({
      remoteName: entry.name,
      remoteUrl: entry.localPath,
      cause: new Error(
        `Ui source "${entry.name}" has no SSR entry URL — set the ui ssr field in production, or run the dev stack with --ssr`,
      ),
    });
  }
  const entryUrl = `${entry.ssrUrl.replace(/\/$/, "")}/${UI_REMOTE_SERVER_ENTRY_FILENAME}`;
  if (entry.ssrIntegrity) {
    return `${entryUrl}?v=${encodeURIComponent(entry.ssrIntegrity)}`;
  }
  if (entry.containerVersion) {
    return `${entryUrl}?v=${encodeURIComponent(entry.containerVersion)}`;
  }
  return entryUrl;
}

function verifyEntryIntegrity(params: {
  remoteName: string;
  remoteUrl?: string;
  entryUrl: string;
  integrity?: string;
}) {
  return Effect.tryPromise({
    try: () =>
      params.integrity
        ? verifySsrEntryIntegrity(params.entryUrl, params.integrity)
        : Promise.resolve(),
    catch: (e) =>
      new FederationError({
        remoteName: params.remoteName,
        remoteUrl: params.remoteUrl,
        cause: e instanceof Error ? e : new Error(String(e)),
      }),
  });
}

function verifyUiEntry(entry: UiRemoteEntry, entryUrl: string) {
  return verifyEntryIntegrity({
    remoteName: entry.name,
    remoteUrl: entry.ssrUrl,
    entryUrl,
    integrity: entry.ssrIntegrity,
  });
}

function loadUiExpose<T>(params: {
  entry: UiRemoteEntry;
  expose: string;
  unwrapDefault: boolean;
  timeoutLabel: string;
}) {
  const { entry, expose, unwrapDefault, timeoutLabel } = params;
  return Effect.gen(function* () {
    const entryUrl = ssrEntryUrlOf(entry);
    yield* verifyUiEntry(entry, entryUrl);
    const cacheKey = `${entry.name}::${entryUrl}::${entry.ssrIntegrity ?? "no-integrity"}::${expose}`;
    return yield* Effect.tryPromise({
      try: () =>
        loadRemoteExpose<T>({
          cacheKey,
          remoteName: entry.name,
          entryUrl,
          expose: `${entry.name}/${expose.replace(/^\.\//, "")}`,
          cache: uiExposeCache as Map<string, CachedPromise<T>>,
          ttlMs: UI_EXPOSE_CACHE_TTL_MS,
          maxSize: MAX_UI_EXPOSE_CACHE_SIZE,
          unwrapDefault,
          bypassModuleCache: false,
        }),
      catch: (e) =>
        new FederationError({ remoteName: entry.name, remoteUrl: entry.ssrUrl, cause: e }),
    });
  }).pipe(
    Effect.timeout("30 seconds"),
    Effect.tapError((error: Error) =>
      Effect.logError(`[SSR] ${timeoutLabel} ${entry.name} failed: ${error.message}`),
    ),
  );
}

/** A plugin ui's generated import map (`./routeConfig` expose) for host construction. */
export const loadUiRouteConfig = (entry: UiRemoteEntry) =>
  loadUiExpose<RouteConfigModule>({
    entry,
    expose: UI_EXPOSES.routeConfig,
    unwrapDefault: false,
    timeoutLabel: "Ui routeConfig",
  }).pipe(
    Effect.flatMap((module) => {
      if (module?.routeConfigLoaders && typeof module.routeConfigLoaders === "object") {
        return Effect.succeed(module);
      }
      return Effect.fail(
        new FederationError({
          remoteName: entry.name,
          remoteUrl: entry.ssrUrl,
          cause: new Error(
            `routeConfig expose resolved without routeConfigLoaders — the built container name likely does not match the registered remote name "${entry.name}"`,
          ),
        }),
      );
    }),
  );

export interface ComposeModule {
  constructTree: (input: ConstructInput) => Promise<ConstructedTree>;
}

/** The core ui's construction engine (`./compose` expose) — executes inside the core's module graph. */
export const loadUiComposeModule = (entry: UiRemoteEntry) =>
  loadUiExpose<ComposeModule>({
    entry,
    expose: UI_EXPOSES.compose,
    unwrapDefault: false,
    timeoutLabel: "Ui compose",
  });

/** The core ui's generated import map (`./routeConfig` expose). */
export const loadCoreUiRouteConfig = (entry: UiRemoteEntry) =>
  loadUiExpose<RouteConfigModule>({
    entry,
    expose: UI_EXPOSES.routeConfig,
    unwrapDefault: false,
    timeoutLabel: "Ui routeConfig",
  });

export const loadRouterModule = (config: RuntimeConfig, localEntry?: UiRemoteEntry) =>
  Effect.gen(function* () {
    const useCache = shouldCacheRouterModule(config) && !localEntry;
    const ssrEntryUrl = localEntry ? ssrEntryUrlOf(localEntry) : getSsrEntryUrl(config);
    const ssrIntegrity = localEntry ? localEntry.ssrIntegrity : config.ui.ssrIntegrity;

    if (ssrIntegrity) {
      yield* verifyEntryIntegrity({
        remoteName: config.ui.name,
        remoteUrl: config.ui.ssrUrl,
        entryUrl: ssrEntryUrl,
        integrity: ssrIntegrity,
      });
    }

    const cacheKey = `${config.ui.name}::${ssrEntryUrl}::${ssrIntegrity ?? "no-integrity"}`;

    const loadedModule = yield* Effect.tryPromise({
      try: () =>
        loadRemoteExpose<RouterModule>({
          cacheKey,
          remoteName: config.ui.name,
          entryUrl: ssrEntryUrl,
          expose: `${config.ui.name}/Router`,
          cache: useCache ? routerModuleCache : new Map(),
          ttlMs: ROUTER_MODULE_CACHE_TTL_MS,
          maxSize: MAX_ROUTER_MODULE_CACHE_SIZE,
          unwrapDefault: true,
          bypassModuleCache: !useCache,
        }),
      catch: (e) =>
        new FederationError({
          remoteName: config.ui.name,
          remoteUrl: config.ui.ssrUrl,
          cause: e,
        }),
    });

    return loadedModule;
  }).pipe(
    Effect.timeout("30 seconds"),
    Effect.tapError((error: Error) => Effect.logError(`[SSR] Failed: ${error.message}`)),
  );
