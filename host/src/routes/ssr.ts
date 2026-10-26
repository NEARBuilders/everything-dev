import type { Effect } from "effect";
import type { Context } from "hono";
import type { AuthVariables } from "../lib/auth";
import { buildPluginContext } from "../services/auth";
import type { RuntimeConfig } from "../services/config";
import type { FederationContainers } from "../services/federation/containers";
import type { FederationLoader } from "../services/federation/loader";
import type { PluginResult } from "../services/plugins";
import { createSsrRender, type ServingSnapshot } from "../services/ssr-render";

type HonoEnv = { Variables: AuthVariables };

type Federated<A, E> = Effect.Effect<A, E, FederationContainers | FederationLoader>;

/**
 * Thin Hono adapter over the SSR render module: extracts the framework
 * specifics (API path routing, secure-headers nonce, plugin context) and
 * delegates the entire request-to-stream pipeline.
 */
export function createSsrFallbackHandler(
  config: RuntimeConfig,
  plugins: PluginResult,
  CSP_STRICT: boolean,
  getServingState?: () => Promise<ServingSnapshot>,
  runFederated?: <A, E>(effect: Federated<A, E>) => Promise<A>,
) {
  const render = createSsrRender({
    config,
    getServingState,
    plugins,
    ...(runFederated ? { runFederated } : {}),
  });
  return async (c: Context<HonoEnv>) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
      return c.notFound();
    }
    return render(c.req.raw, {
      session: c.get("session"),
      user: c.get("user"),
      pluginContext: buildPluginContext(c),
      cspNonce: CSP_STRICT ? c.get("secureHeadersNonce") : undefined,
      cspHeader: c.res.headers.get("Content-Security-Policy"),
    });
  };
}
