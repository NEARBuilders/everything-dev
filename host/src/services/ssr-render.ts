import { Effect, Layer, ManagedRuntime, References } from "effect";
import type { ComposePayload } from "everything-dev/ui/manifest";
import { renderClientShell } from "../routes/html";
import type { RouterModule } from "../types";
import { mark, minimumLogLevel, runEffect } from "../utils/effect-run";
import { logger } from "../utils/logger";
import {
  buildRuntimeClientConfig,
  type ClientRuntimeConfig,
  type RuntimeConfig,
  resolveActiveRuntime,
} from "./config";
import { FederationContainers } from "./federation/containers";
import { FederationLifecycle } from "./federation/lifecycle";
import { FederationLoader } from "./federation/loader";
import { createNonceNormalizer } from "./nonce-normalizer";
import { createPluginsClient, type PluginResult } from "./plugins";
import {
  type ClientConfigCacheState,
  createClientConfigCacheState,
  enforceCacheLimit,
  pruneExpiredEntries,
} from "./serving-caches";
import { getTenantRuntimeErrorResponse, resolveRequestRuntime } from "./tenant-runtime";
import {
  type ComposedUi,
  composeClientPayload,
  composeUi,
  createUiComposeCacheState,
  isSsrAvailable,
  type UiComposeCacheState,
  UiComposer,
} from "./ui-composer";

/**
 * One seam from request to stream: tenant resolution, manifest composition,
 * streaming render, and the client-shell fallback all live behind
 * `render(request, ctx) -> Response`. No Hono, no framework — plain Request
 * in, Response out, so the whole pipeline is testable through the interface.
 *
 * Composition is the SSR model (ADR 0007): the core ui's own routes are
 * manifest-composed too, so composition runs whenever SSR is available —
 * boot health gates the base variant; per-request tenant variants compose
 * on first hit and cache by digest. Compose failures fail LOUD (500), never
 * a silent wrong-tree render; the CSR shell (no-SSR deployments and the
 * stream-failure path) carries the client compose payload so the browser
 * composes plugin routes itself, falling back to core-only only when the
 * payload cannot be built.
 */

export interface SsrRenderDeps {
  config: RuntimeConfig;
  /** per-request serving capture (atomic-deploys 06, C7): when present, the
   * request captures ONE snapshot state — config + both serving caches — and
   * composes through it, so a swap under traffic flips readers atomically;
   * in-flight requests keep the state they captured (shadow-flip, no drain) */
  getServingState?: () => Promise<ServingSnapshot>;
  plugins: PluginResult;
  /** Runs compose effects with the federation services in context. The server
   * passes its runtime context so the composition instance and container
   * servers live for the server's whole life; standalone callers (tests)
   * get a lifecycle-scoped runtime built once per render instance. */
  runFederated?: <A, E>(
    effect: Effect.Effect<A, E, FederationContainers | FederationLoader | UiComposer>,
  ) => Promise<A>;
}

/** The serving surface a request composes through — structurally the
 * RuntimeSnapshotState (config + caches move together). */
export interface ServingSnapshot {
  config: RuntimeConfig;
  composeState: UiComposeCacheState;
  clientConfigState: ClientConfigCacheState;
}

export interface SsrRenderRequestContext {
  session: unknown;
  user: unknown;
  pluginContext: Record<string, unknown>;
  cspNonce?: string;
  cspHeader?: string | null;
}

export { isSsrAvailable };

const CLIENT_CONFIG_TTL_MS = 30_000;
const MAX_CLIENT_CONFIG_CACHE_SIZE = 512;

/**
 * The client runtime payload only varies with tenant identity, request
 * origin, auth availability, and the composed digest — rebuild it once per
 * window instead of once per request.
 */
function buildClientConfigCached(
  inputs: {
    effectiveConfig: RuntimeConfig;
    request: Request;
    tenantAccountId: string | null;
    authAvailable: boolean;
    composePayload: ComposePayload;
  },
  cache: ClientConfigCacheState,
): ClientRuntimeConfig {
  const now = Date.now();
  pruneExpiredEntries(cache.entries, now);
  const origin = new URL(inputs.request.url).origin;
  const cacheKey = `${inputs.tenantAccountId ?? "base"}::${origin}::${inputs.authAvailable}::${inputs.composePayload.digest}`;
  const cached = cache.entries.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const activeRuntime = resolveActiveRuntime(inputs.effectiveConfig, inputs.request);
  const value = buildRuntimeClientConfig(
    inputs.effectiveConfig,
    inputs.request,
    activeRuntime,
    inputs.authAvailable,
    inputs.composePayload,
  );
  cache.entries.set(cacheKey, { value, expiresAt: now + CLIENT_CONFIG_TTL_MS });
  enforceCacheLimit(cache.entries, MAX_CLIENT_CONFIG_CACHE_SIZE);
  return value;
}

function textResponse(message: string, status: number, requestId?: string) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=UTF-8",
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
  });
}

/**
 * One capture per request: when `getServingState` is provided, config and both
 * serving caches ride the same snapshot state, so a swap can never split them
 * across a request. Loader API calls get a 15s deadline — a wedged plugin
 * endpoint rejects into the route's error boundary and closes the stream
 * instead of suspending it forever.
 */
const formatDur = (ms: number) => (Math.round(ms * 10) / 10).toFixed(1);

export function createSsrRender(deps: SsrRenderDeps) {
  const fallbackComposeCache = createUiComposeCacheState();
  const fallbackClientConfigCache = createClientConfigCacheState();
  const runFederated =
    deps.runFederated ??
    (() => {
      // Standalone callers (tests): one lifecycle-scoped runtime per render
      // instance — the composition instance and container servers live as long
      // as the render fn. runEffect re-wires the CLI log-level service so the
      // request-path compose marks stay visible under BOS_LOG_LEVEL=debug.
      const runtime = ManagedRuntime.make(
        Layer.mergeAll(
          FederationLifecycle.layer,
          Layer.succeed(References.MinimumLogLevel, minimumLogLevel()),
        ),
      );
      let services: Promise<{
        containers: FederationContainers["Service"];
        loader: FederationLoader["Service"];
        composer: UiComposer["Service"];
      }> | null = null;
      const load = () =>
        (services ??= (async () => ({
          containers: await runtime.runPromise(FederationContainers),
          loader: await runtime.runPromise(FederationLoader),
          composer: await runtime.runPromise(UiComposer),
        }))());
      return async <A, E>(
        effect: Effect.Effect<A, E, FederationContainers | FederationLoader | UiComposer>,
      ): Promise<A> => {
        const { containers, loader, composer } = await load();
        return runEffect(
          effect.pipe(
            Effect.provideService(FederationContainers, containers),
            Effect.provideService(FederationLoader, loader),
            Effect.provideService(UiComposer, composer),
          ),
        );
      };
    })();
  return async (request: Request, ctx: SsrRenderRequestContext): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    const requestId = crypto.randomUUID().slice(0, 8);
    const startedAt = Date.now();

    const serving = deps.getServingState ? await deps.getServingState() : undefined;

    const composeCache = serving?.composeState ?? fallbackComposeCache;
    const clientConfigCache = serving?.clientConfigState ?? fallbackClientConfigCache;

    let resolved: Awaited<ReturnType<typeof resolveRequestRuntime>>;
    try {
      const baseConfig = serving?.config ?? deps.config;
      const resolveStartedAt = Date.now();
      resolved = await resolveRequestRuntime(baseConfig, request, {
        verification: "blocking",
      });
      mark("tenant resolution", {
        requestId,
        durationMs: Math.round(Date.now() - resolveStartedAt),
      });
    } catch (error) {
      const { message, status } = getTenantRuntimeErrorResponse(error);
      logger.error(`[SSR] ${requestId} ${request.method} ${pathname} — ${message}`);
      return textResponse(message, status, requestId);
    }

    const effectiveConfig = resolved.config;

    let composeMs = 0;
    if (!isSsrAvailable(effectiveConfig)) {
      const activeRuntime = resolveActiveRuntime(effectiveConfig, request);
      let composePayload: ComposePayload | undefined;
      try {
        const composeStartedAt = Date.now();
        composePayload = (await runFederated(composeClientPayload(effectiveConfig, composeCache)))
          ?.clientPayload;
        mark("client payload compose", {
          requestId,
          durationMs: Math.round(Date.now() - composeStartedAt),
        });
      } catch (error) {
        logger.warn(
          `[SSR] ${requestId} Client compose payload failed for ${pathname} — serving the core-only shell:`,
          error,
        );
      }
      const runtimeConfig = buildRuntimeClientConfig(
        effectiveConfig,
        request,
        activeRuntime,
        deps.plugins.auth !== null,
        composePayload,
      );
      return renderClientShell(
        ctx.cspNonce,
        effectiveConfig,
        runtimeConfig,
        null,
        ctx.cspHeader,
        requestId,
      );
    }

    let composed: ComposedUi;
    try {
      const composeStartedAt = Date.now();
      composed = await runFederated(composeUi(effectiveConfig, composeCache));
      composeMs = Date.now() - composeStartedAt;
    } catch (error) {
      logger.error(`[SSR] ${requestId} Manifest composition failed for ${pathname}:`, error);
      return textResponse("SSR composition failed", 500, requestId);
    }

    const runtimeConfig = buildClientConfigCached(
      {
        effectiveConfig,
        request,
        tenantAccountId: resolved.tenantAccountId,
        authAvailable: deps.plugins.auth !== null,
        composePayload: composed.clientPayload,
      },
      clientConfigCache,
    );

    const ssrRouterModule: RouterModule = composed.routerModule;

    try {
      const ssrApiClient = createPluginsClient(deps.plugins, ctx.pluginContext, {
        callTimeoutMs: 15_000,
      });

      const renderStartedAt = Date.now();
      const result = await ssrRouterModule.renderToStream(request, {
        session: ctx.session ? { session: ctx.session, user: ctx.user } : null,
        basepath: runtimeConfig.runtime?.runtimeBasePath,
        runtimeConfig,
        apiClient: ssrApiClient,
        cspNonce: ctx.cspNonce,
        routeTree: composed.routeTree,
        pluginNav: composed.nav,
        requestId,
      });
      const renderMs = Date.now() - renderStartedAt;

      const responseHeaders = new Headers(result?.headers);
      if (ctx.cspHeader) {
        responseHeaders.set("Content-Security-Policy", ctx.cspHeader);
      }
      responseHeaders.set("x-request-id", requestId);
      responseHeaders.set(
        "server-timing",
        `compose;dur=${formatDur(composeMs)}, render;dur=${formatDur(renderMs)}, total;dur=${formatDur(Date.now() - startedAt)}`,
      );
      mark("ssr render complete", {
        requestId,
        digest: composed.digest,
        composeMs: Math.round(composeMs),
        renderMs: Math.round(renderMs),
        totalMs: Math.round(Date.now() - startedAt),
      });
      const stream =
        ctx.cspNonce && result?.stream
          ? (result.stream as ReadableStream<Uint8Array>).pipeThrough(
              createNonceNormalizer(ctx.cspNonce),
            )
          : result?.stream;
      return new Response(stream, {
        status: result?.statusCode,
        headers: responseHeaders,
      });
    } catch (error) {
      logger.error(`[SSR] ${requestId} Streaming error for ${pathname}:`, error);
      return renderClientShell(
        ctx.cspNonce,
        effectiveConfig,
        runtimeConfig,
        error as Error,
        ctx.cspHeader,
        requestId,
      );
    }
  };
}
