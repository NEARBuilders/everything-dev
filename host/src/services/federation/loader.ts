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
import { CompositionRuntime, type CompositionSession } from "./instance";

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

interface CachedLoad {
  readonly session: CompositionSession;
  readonly params: ExposeLoadParams;
}

/**
 * TTL-capped, retry-bounded, negative-cached expose loads executed through a
 * compose-pinned generation session.
 *
 * Invariants (epic #473, tickets #470/#478):
 *
 * 1. Integrity is verified before every expose load that carries one —
 *    verified entries cache 5 minutes; a FAILED verification is not
 *    negative-cached (it re-verifies on the next request).
 * 2. Successful loads cache 5 minutes; a FAILED load negative-caches 10
 *    seconds so a downed remote is probed once per window, not once per
 *    request. In-flight lookups are shared.
 * 3. Cache keys carry the composition generation: a retired generation's
 *    cached modules can never serve into a newer generation's tree (mixed
 *    generations mix React copies — "Invalid hook call"). A generation swap
 *    re-loads everything through the fresh instance; capacity eviction reaps
 *    the dead keys.
 * 4. Every outbound fetch carries a deadline; a wedged remote rejects into
 *    the caller's error path instead of suspending the request forever.
 */
export class FederationLoader extends Context.Service<
  FederationLoader,
  {
    /** Open (or join) the composition session for one compose's desired
     * remote entry set — see `CompositionRuntime.ensureRemotes`. */
    readonly ensureSession: (remotes: { name: string; entry: string }[]) => CompositionSession;
    readonly verifyIntegrity: (params: {
      remoteName: string;
      remoteUrl?: string;
      entryUrl: string;
      integrity?: string;
    }) => Effect.Effect<void, FederationError>;
    readonly loadExpose: <T>(
      params: ExposeLoadParams & { session: CompositionSession },
    ) => Effect.Effect<T, FederationError>;
    readonly loadRouterModule: (
      params: RouterLoadParams & { session: CompositionSession },
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

      const exposeParams = new Map<string, CachedLoad>();
      const exposeCache = yield* Cache.makeWith<string, unknown, FederationError>(
        (key) => {
          const cached = exposeParams.get(key);
          if (!cached) {
            return Effect.fail(
              new FederationError({
                remoteName: key,
                cause: new Error(`expose load params missing for ${key}`),
              }),
            );
          }
          return loadExposeLookup(runtime, cached);
        },
        {
          capacity: MAX_EXPOSE_CACHE_SIZE,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? EXPOSE_CACHE_TTL : NEGATIVE_CACHE_TTL),
        },
      );

      const routerParams = new Map<string, CachedLoad>();
      const routerCache = yield* Cache.makeWith<string, RouterModule, FederationError>(
        (key) => {
          const cached = routerParams.get(key);
          if (!cached) {
            return Effect.fail(
              new FederationError({
                remoteName: key,
                cause: new Error(`router load params missing for ${key}`),
              }),
            );
          }
          return loadExposeLookup(runtime, cached) as Effect.Effect<RouterModule, FederationError>;
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

      const loadExpose = <T>(
        params: ExposeLoadParams & { session: CompositionSession },
      ): Effect.Effect<T, FederationError> => {
        const cacheKey = exposeCacheKey(params.session.generation, params);
        exposeParams.set(cacheKey, { session: params.session, params });
        return Cache.get(exposeCache, cacheKey) as unknown as Effect.Effect<T, FederationError>;
      };

      const loadRouterModule = (
        params: RouterLoadParams & { session: CompositionSession },
      ): Effect.Effect<RouterModule, FederationError> => {
        if (params.bypassModuleCache) {
          // Local dev / no-integrity loads skip the cache entirely — every
          // request re-executes the expose (hot-reload support) inside the
          // session's generation. No throwaway per-call map: nothing cached.
          return loadExposeLookup<RouterModule>(runtime, {
            session: params.session,
            params,
          });
        }
        const cacheKey = exposeCacheKey(params.session.generation, params);
        routerParams.set(cacheKey, { session: params.session, params });
        return Cache.get(routerCache, cacheKey);
      };

      return FederationLoader.of({
        ensureSession: (remotes) => runtime.ensureRemotes(remotes),
        verifyIntegrity,
        loadExpose,
        loadRouterModule,
      });
    }),
  ).pipe(Layer.provide(CompositionRuntime.layer));
}

const exposeCacheKey = (generation: number, params: ExposeLoadParams) =>
  `${generation}::${params.remoteName}::${params.entryUrl}::${params.expose}`;

/**
 * One expose load through the compose-pinned session: serialized share-scope
 * init, retry-bounded load, unwrap per the expose's contract. The session's
 * instance already carries this remote at this entry — reconciliation
 * happened when the compose opened its session.
 */
const loadExposeLookup = <T>(
  runtime: CompositionRuntime["Service"],
  cached: CachedLoad,
): Effect.Effect<T, FederationError> =>
  Effect.gen(function* () {
    const { session, params } = cached;
    const { remoteName, entryUrl, expose, unwrapDefault, bypassModuleCache } = params;
    if (bypassModuleCache) {
      runtime.bypassModuleCache(session, remoteName);
    }

    const startedAt = yield* Clock.currentTimeMillis;
    yield* runtime.initializeShareScope(session.mf);
    const result = yield* Effect.tryPromise({
      try: () => session.mf.loadRemote<any>(expose, { from: "build" }),
      catch: (cause) => new FederationError({ remoteName, remoteUrl: entryUrl, cause }),
    }).pipe(Effect.timeout("30 seconds"));
    yield* Effect.logDebug("expose load").pipe(
      Effect.annotateLogs({
        remote: remoteName,
        expose,
        generation: session.generation,
        bypassModuleCache,
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
            remoteName: cached.params.remoteName,
            remoteUrl: cached.params.entryUrl,
            cause: error,
          }),
    ),
  );

function hasRouteConfigLoaders(
  module: RouteConfigModule,
): module is RouteConfigModule & { routeConfigLoaders: object } {
  return Boolean(module?.routeConfigLoaders && typeof module.routeConfigLoaders === "object");
}

/** The SSR container entry URL for an entry slot — versioned (dev buster /
 * pin-derived) so a rebuilt container is a NEW entry, the generation-swap
 * trigger. Exported for composeUi to assemble the compose's full desired
 * remote set before any load executes. */
export function requireSsrEntryUrl(entry: EntrySlot, env: BosEnv): string {
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
    session: CompositionSession;
  }) {
    const { entry, env, expose, unwrapDefault, session } = params;
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
      session,
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
  session: CompositionSession,
) {
  const module = yield* loadUiExpose<RouteConfigModule>({
    entry,
    env,
    expose: UI_EXPOSES.routeConfig,
    unwrapDefault: false,
    timeoutLabel: "Ui routeConfig",
    session,
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
  session: CompositionSession,
) {
  return yield* loadUiExpose<ComposeModule>({
    entry,
    env,
    expose: UI_EXPOSES.compose,
    unwrapDefault: false,
    timeoutLabel: "Ui compose",
    session,
  });
});

/** The core ui's generated import map (`./routeConfig` expose) — validated identically to plugin ui loads. */
export const loadCoreUiRouteConfig = loadUiRouteConfig;

export const loadRouterModule = Effect.fn("loadRouterModule")(
  function* (
    config: RuntimeConfig,
    localEntry: EntrySlot | undefined,
    session: CompositionSession,
  ) {
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
      session,
    });
  },
  (effect, config: RuntimeConfig, _localEntry?: EntrySlot, _session?: CompositionSession) =>
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
