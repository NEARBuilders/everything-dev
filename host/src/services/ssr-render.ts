import { Effect } from "effect";
import type { ComposePayload } from "everything-dev/ui/manifest";
import { renderClientShell } from "../routes/html";
import type { RouterModule } from "../types";
import { logger } from "../utils/logger";
import {
  buildRuntimeClientConfig,
  type ClientRuntimeConfig,
  type RuntimeConfig,
  resolveActiveRuntime,
} from "./config";
import { createPluginsClient, type PluginResult } from "./plugins";
import { getTenantRuntimeErrorResponse, resolveRequestRuntime } from "./tenant-runtime";
import { enforceCacheLimit, pruneExpiredEntries } from "./ttl-cache";
import { type ComposedUi, composeClientPayload, composeUi, isSsrAvailable } from "./ui-compose";

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
  plugins: PluginResult;
}

export interface SsrRenderRequestContext {
  session: unknown;
  user: unknown;
  pluginContext: Record<string, unknown>;
  cspNonce?: string;
  cspHeader?: string | null;
}

export { isSsrAvailable };

interface CachedClientConfig {
  expiresAt: number;
  value: ClientRuntimeConfig;
}

const CLIENT_CONFIG_TTL_MS = 30_000;
const MAX_CLIENT_CONFIG_CACHE_SIZE = 512;

const clientConfigCache = new Map<string, CachedClientConfig>();

/**
 * The client runtime payload only varies with tenant identity, request
 * origin, auth availability, and the composed digest — rebuild it once per
 * window instead of once per request.
 */
function buildClientConfigCached(inputs: {
  effectiveConfig: RuntimeConfig;
  request: Request;
  tenantAccountId: string | null;
  authAvailable: boolean;
  composePayload: ComposePayload;
}): ClientRuntimeConfig {
  const now = Date.now();
  pruneExpiredEntries(clientConfigCache, now);
  const origin = new URL(inputs.request.url).origin;
  const cacheKey = `${inputs.tenantAccountId ?? "base"}::${origin}::${inputs.authAvailable}::${inputs.composePayload.digest}`;
  const cached = clientConfigCache.get(cacheKey);
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
  clientConfigCache.set(cacheKey, { value, expiresAt: now + CLIENT_CONFIG_TTL_MS });
  enforceCacheLimit(clientConfigCache, MAX_CLIENT_CONFIG_CACHE_SIZE);
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

export function createSsrRender(deps: SsrRenderDeps) {
  return async (request: Request, ctx: SsrRenderRequestContext): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    const requestId = crypto.randomUUID().slice(0, 8);

    let resolved: Awaited<ReturnType<typeof resolveRequestRuntime>>;
    try {
      resolved = await resolveRequestRuntime(deps.config, request, {
        verification: "blocking",
      });
    } catch (error) {
      const { message, status } = getTenantRuntimeErrorResponse(error);
      logger.error(`[SSR] ${requestId} ${request.method} ${pathname} — ${message}`);
      return textResponse(message, status, requestId);
    }

    const effectiveConfig = resolved.config;

    if (!isSsrAvailable(effectiveConfig)) {
      const activeRuntime = resolveActiveRuntime(effectiveConfig, request);
      let composePayload: ComposePayload | undefined;
      try {
        composePayload = (await Effect.runPromise(composeClientPayload(effectiveConfig)))
          ?.clientPayload;
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
      composed = await Effect.runPromise(composeUi(effectiveConfig));
    } catch (error) {
      logger.error(`[SSR] ${requestId} Manifest composition failed for ${pathname}:`, error);
      return textResponse("SSR composition failed", 500, requestId);
    }

    const runtimeConfig = buildClientConfigCached({
      effectiveConfig,
      request,
      tenantAccountId: resolved.tenantAccountId,
      authAvailable: deps.plugins.auth !== null,
      composePayload: composed.clientPayload,
    });

    const ssrRouterModule: RouterModule = composed.routerModule;

    try {
      const ssrApiClient = createPluginsClient(deps.plugins, ctx.pluginContext, {
        // Loader API calls get a deadline: a wedged plugin endpoint rejects
        // into the route's error boundary and closes the stream instead of
        // suspending it forever.
        callTimeoutMs: 15_000,
      });

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

      const responseHeaders = new Headers(result?.headers);
      if (ctx.cspHeader) {
        responseHeaders.set("Content-Security-Policy", ctx.cspHeader);
      }
      responseHeaders.set("x-request-id", requestId);
      return new Response(result?.stream, {
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
