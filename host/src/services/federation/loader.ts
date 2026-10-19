import { Cache, Clock, Context, Duration, Effect, Exit, Layer, Schedule } from "effect";
import type { BosEnv } from "everything-dev/config";
import { verifySriForUrl } from "everything-dev/integrity";
import {
  type ConstructedTree,
  type ConstructInput,
  type EntrySlot,
  entryUrls,
  type RouteConfigModule,
  UI_EXPOSES,
} from "everything-dev/ui/manifest";
import type { RouterModule } from "../../types";
import { mark } from "../../utils/effect-run";
import type { RuntimeConfig } from "../config";
import { ExposeModuleMissing, FederationError } from "../errors";
import { CompositionRuntime } from "./instance";

const EXPOSE_CACHE_TTL = "5 minutes";
const NEGATIVE_CACHE_TTL = "10 seconds";
const INTEGRITY_VERIFY_TIMEOUT = "30 seconds";
const MAX_EXPOSE_CACHE_SIZE = 256;
const MAX_ROUTER_MODULE_CACHE_SIZE = 128;

const retrySchedule = Schedule.addDelay(Schedule.recurs(5), () => Effect.succeed(500));

/** `entryUrl::integrity` — integrity never contains "::". */
interface IntegrityKey {
  readonly entryUrl: string;
  readonly integrity: string;
}

const integrityKey = (entryUrl: string, integrity: string) => `${entryUrl}::${integrity}`;
const parseIntegrityKey = (key: string): IntegrityKey => {
  const index = key.lastIndexOf("::");
  return { entryUrl: key.slice(0, index), integrity: key.slice(index + 2) };
};

interface ExposeLoadParams {
  readonly remoteName: string;
  readonly entryUrl: string;
  readonly expose: string;
  readonly unwrapDefault: boolean;
  readonly bypassModuleCache: boolean;
}

interface RouterLoadParams extends ExposeLoadParams {}

/**
 * TTL-capped, retry-bounded, negative-cached expose loads served through the
 * SHARED composition instance so core Router and plugin trees negotiate
 * singletons (react, react-dom, @tanstack/*) in one share scope.
 *
 * Invariants (epic #473, ticket #470):
 *
 * 1. Integrity is verified before every expose load that carries one —
 *    verified entries cache 5 minutes; a FAILED verification is not
 *    negative-cached (it re-verifies on the next request).
 * 2. Successful loads cache 5 minutes; a FAILED load negative-caches 10
 *    seconds so a downed remote is probed once per window, not once per
 *    request. In-flight lookups are shared.
 * 3. An entry-URL change (integrity bump, hot reload) bypasses the runtime's
 *    module cache — no mixed-version composed tree.
 * 4. Every outbound fetch carries a deadline; a wedged remote rejects into
 *    the caller's error path instead of suspending the request forever.
 */
export class FederationLoader extends Context.Service<
  FederationLoader,
  {
    readonly verifyIntegrity: (params: {
      remoteName: string;
      remoteUrl?: string;
      entryUrl: string;
      integrity?: string;
    }) => Effect.Effect<void, FederationError>;
    readonly loadExpose: <T>(params: ExposeLoadParams) => Effect.Effect<T, FederationError>;
    readonly loadRouterModule: (
      params: RouterLoadParams,
    ) => Effect.Effect<RouterModule, FederationError>;
  }
>()("host/services/federation/FederationLoader") {
  static readonly layer = Layer.effect(
    FederationLoader,
    Effect.gen(function* () {
      const runtime = yield* CompositionRuntime;

      const integrityCache = yield* Cache.makeWith<string, void, unknown>(
        (key) => {
          const { entryUrl, integrity } = parseIntegrityKey(key);
          const startedAt = Date.now();
          return Effect.tryPromise({
            try: () =>
              verifySriForUrl(entryUrl, integrity, { resolveEntryUrl: false }).then(() => {
                mark("integrity verify", {
                  entryUrl,
                  durationMs: Math.round(Date.now() - startedAt),
                });
              }),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          }).pipe(Effect.timeout(INTEGRITY_VERIFY_TIMEOUT));
        },
        {
          capacity: MAX_EXPOSE_CACHE_SIZE,
          // A failed verification must re-probe on the next request: zero TTL
          // evicts the failure immediately (in-flight lookups still share).
          timeToLive: (exit) => (Exit.isSuccess(exit) ? EXPOSE_CACHE_TTL : Duration.zero),
        },
      );

      const exposeParams = new Map<string, ExposeLoadParams>();
      const exposeCache = yield* Cache.makeWith<string, unknown, FederationError>(
        (key) => {
          const params = exposeParams.get(key);
          if (!params) {
            return Effect.fail(
              new FederationError({
                remoteName: key,
                cause: new Error(`expose load params missing for ${key}`),
              }),
            );
          }
          return loadExposeLookup(runtime, params);
        },
        {
          capacity: MAX_EXPOSE_CACHE_SIZE,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? EXPOSE_CACHE_TTL : NEGATIVE_CACHE_TTL),
        },
      );

      const routerParams = new Map<string, RouterLoadParams>();
      const routerCache = yield* Cache.makeWith<string, RouterModule, FederationError>(
        (key) => {
          const params = routerParams.get(key);
          if (!params) {
            return Effect.fail(
              new FederationError({
                remoteName: key,
                cause: new Error(`router load params missing for ${key}`),
              }),
            );
          }
          return loadExposeLookup(runtime, params);
        },
        {
          capacity: MAX_ROUTER_MODULE_CACHE_SIZE,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? EXPOSE_CACHE_TTL : NEGATIVE_CACHE_TTL),
        },
      );

      const verifyIntegrity = (params: {
        remoteName: string;
        remoteUrl?: string;
        entryUrl: string;
        integrity?: string;
      }): Effect.Effect<void, FederationError> => {
        if (!params.integrity) return Effect.void;
        return Cache.get(integrityCache, integrityKey(params.entryUrl, params.integrity)).pipe(
          Effect.mapError(
            (cause) =>
              new FederationError({
                remoteName: params.remoteName,
                remoteUrl: params.remoteUrl,
                cause: cause instanceof Error ? cause : new Error(String(cause)),
              }),
          ),
        );
      };

      const loadExpose = <T>(params: ExposeLoadParams): Effect.Effect<T, FederationError> => {
        const cacheKey = exposeCacheKey(params);
        exposeParams.set(cacheKey, params);
        return Cache.get(exposeCache, cacheKey) as unknown as Effect.Effect<T, FederationError>;
      };

      const loadRouterModule = (
        params: RouterLoadParams,
      ): Effect.Effect<RouterModule, FederationError> => {
        const cacheKey = `${params.remoteName}::${params.entryUrl}::${params.expose}`;
        if (params.bypassModuleCache) {
          // Local dev / no-integrity loads skip the cache entirely — every
          // request re-executes the expose through a fresh container
          // (hot-reload support). No throwaway per-call map: nothing cached.
          return loadExposeLookup<RouterModule>(runtime, params);
        }
        routerParams.set(cacheKey, params);
        return Cache.get(routerCache, cacheKey);
      };

      return FederationLoader.of({ verifyIntegrity, loadExpose, loadRouterModule });
    }),
  ).pipe(Layer.provide(CompositionRuntime.layer));
}

const exposeCacheKey = (params: ExposeLoadParams) =>
  `${params.remoteName}::${params.entryUrl}::${params.expose}`;

/**
 * One expose load through the shared composition instance: register/re-register
 * the remote (entry-change ⇒ bypass the runtime's module cache), serialized
 * share-scope init, retry-bounded load, unwrap per the expose's contract.
 */
const loadExposeLookup = <T>(
  runtime: CompositionRuntime["Service"],
  params: ExposeLoadParams,
): Effect.Effect<T, FederationError> =>
  Effect.gen(function* () {
    const { remoteName, entryUrl, expose, unwrapDefault, bypassModuleCache } = params;
    const mf = runtime.ensureRemote({ name: remoteName, entry: entryUrl });
    const entryChanged = runtime.entryChanged({ name: remoteName, entry: entryUrl });
    if (bypassModuleCache || entryChanged) {
      runtime.bypassModuleCache(remoteName);
    }
    runtime.markLoaded({ name: remoteName, entry: entryUrl });

    const startedAt = yield* Clock.currentTimeMillis;
    yield* runtime.initializeShareScope(mf);
    const result = yield* Effect.tryPromise({
      try: () => mf.loadRemote<any>(expose, { from: "build" }),
      catch: (cause) => new FederationError({ remoteName, remoteUrl: entryUrl, cause }),
    }).pipe(Effect.timeout("30 seconds"));
    yield* Effect.logDebug("expose load").pipe(
      Effect.annotateLogs({
        remote: remoteName,
        expose,
        bypassModuleCache,
        entryChanged,
        durationMs: (yield* Clock.currentTimeMillis) - startedAt,
      }),
    );
    if (!result) {
      return yield* new ExposeModuleMissing({ expose, reason: "not-found" });
    }
    const module = result as { default?: T } | undefined;
    return unwrapDefault
      ? (module?.default ?? (yield* new ExposeModuleMissing({ expose, reason: "no-default" })))
      : (module as T);
  }).pipe(
    Effect.retry(retrySchedule),
    Effect.mapError((error) =>
      error instanceof FederationError
        ? error
        : new FederationError({
            remoteName: params.remoteName,
            remoteUrl: params.entryUrl,
            cause: error,
          }),
    ),
  );

function hasRouteConfigLoaders(
  module: RouteConfigModule,
): module is RouteConfigModule & { routeConfigLoaders: object } {
  return Boolean(module?.routeConfigLoaders && typeof module.routeConfigLoaders === "object");
}

function requireSsrEntryUrl(entry: EntrySlot, env: BosEnv): string {
  const ssr = entryUrls(entry, env).ssr;
  if (!ssr) {
    throw new FederationError({
      remoteName: entry.name,
      remoteUrl: entry.localPath ?? entry.ssrUrl,
      cause: new Error(
        `Ui source "${entry.name}" has no SSR entry URL — set the ui ssr field in production, or run the dev stack with --ssr`,
      ),
    });
  }
  return ssr;
}

const loadUiExpose = Effect.fn("loadUiExpose")(
  function* <T>(params: {
    entry: EntrySlot;
    env: BosEnv;
    expose: string;
    unwrapDefault: boolean;
    timeoutLabel: string;
  }) {
    const { entry, env, expose, unwrapDefault } = params;
    const loader = yield* FederationLoader;
    const entryUrl = requireSsrEntryUrl(entry, env);
    yield* loader.verifyIntegrity({
      remoteName: entry.name,
      remoteUrl: entry.ssrUrl,
      entryUrl,
      integrity: entry.ssrIntegrity,
    });
    return yield* loader.loadExpose<T>({
      remoteName: entry.name,
      entryUrl,
      expose: `${entry.name}/${expose.replace(/^\.\//, "")}`,
      unwrapDefault,
      bypassModuleCache: false,
    });
  },
  (effect, params) =>
    effect.pipe(
      Effect.timeout("30 seconds"),
      Effect.tapError((error: Error) =>
        Effect.logError(
          `[SSR] ${params.timeoutLabel} ${params.entry.name} failed: ${error.message}`,
        ),
      ),
    ),
);

/** A plugin ui's generated import map (`./routeConfig` expose) for host construction. */
export const loadUiRouteConfig = Effect.fn("loadUiRouteConfig")(function* (
  entry: EntrySlot,
  env: BosEnv,
) {
  const module = yield* loadUiExpose<RouteConfigModule>({
    entry,
    env,
    expose: UI_EXPOSES.routeConfig,
    unwrapDefault: false,
    timeoutLabel: "Ui routeConfig",
  });
  if (hasRouteConfigLoaders(module)) return module;
  return yield* new FederationError({
    remoteName: entry.name,
    remoteUrl: entry.ssrUrl,
    cause: new Error(
      `routeConfig expose resolved without routeConfigLoaders — the built container name likely does not match the registered remote name "${entry.name}"`,
    ),
  });
});

export interface ComposeModule {
  constructTree: (input: ConstructInput) => Promise<ConstructedTree>;
}

/** The core ui's construction engine (`./compose` expose) — executes inside the core's module graph. */
export const loadUiComposeModule = Effect.fn("loadUiComposeModule")(function* (
  entry: EntrySlot,
  env: BosEnv,
) {
  return yield* loadUiExpose<ComposeModule>({
    entry,
    env,
    expose: UI_EXPOSES.compose,
    unwrapDefault: false,
    timeoutLabel: "Ui compose",
  });
});

/** The core ui's generated import map (`./routeConfig` expose) — validated identically to plugin ui loads. */
export const loadCoreUiRouteConfig = loadUiRouteConfig;

export const loadRouterModule = Effect.fn("loadRouterModule")(
  function* (config: RuntimeConfig, localEntry?: EntrySlot) {
    const loader = yield* FederationLoader;
    const useCache = config.ui.source !== "local" && Boolean(config.ui.ssrIntegrity) && !localEntry;
    const ssrEntryUrl = requireSsrEntryUrl(localEntry ?? config.ui, config.env);
    const ssrIntegrity = localEntry ? localEntry.ssrIntegrity : config.ui.ssrIntegrity;

    if (ssrIntegrity) {
      yield* loader.verifyIntegrity({
        remoteName: config.ui.name,
        remoteUrl: config.ui.ssrUrl,
        entryUrl: ssrEntryUrl,
        integrity: ssrIntegrity,
      });
    }

    return yield* loader.loadRouterModule({
      remoteName: config.ui.name,
      entryUrl: ssrEntryUrl,
      expose: `${config.ui.name}/Router`,
      unwrapDefault: true,
      bypassModuleCache: !useCache,
    });
  },
  (effect, config: RuntimeConfig, _localEntry?: EntrySlot) =>
    effect.pipe(
      Effect.timeout("30 seconds"),
      Effect.catch((error: unknown) => {
        // the production error shape: the remote coordinates are the config's
        // SSR slot; the load's own error rides as the cause
        return new FederationError({
          remoteName: config.ui.name,
          remoteUrl: config.ui.ssrUrl,
          cause: error,
        });
      }),
      Effect.tapError((error: Error) => Effect.logError(`[SSR] Failed: ${error.message}`)),
    ),
);
