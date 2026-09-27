import type { Context } from "hono";
import type { AuthVariables } from "../lib/auth";
import { buildPluginContext } from "../services/auth";
import type { RuntimeConfig } from "../services/config";
import type { PluginResult } from "../services/plugins";
import { createSsrRender } from "../services/ssr-render";

type HonoEnv = { Variables: AuthVariables };

/**
 * Thin Hono adapter over the SSR render module: extracts the framework
 * specifics (API path routing, secure-headers nonce, plugin context) and
 * delegates the entire request-to-stream pipeline.
 */
export function createSsrFallbackHandler(
  config: RuntimeConfig,
  plugins: PluginResult,
  CSP_STRICT: boolean,
) {
  const render = createSsrRender({ config, plugins });
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
