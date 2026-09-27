import { Effect, Context as EffectContext } from "effect";
import type { Context, Hono, Next } from "hono";
import type { AuthClient, AuthPluginContext, AuthServices, HonoEnv } from "../lib/auth";
import { logger } from "../utils/logger";
import type { PluginResult } from "./plugins";

function getAuthServices(plugins: PluginResult): AuthServices | null {
  const entry = plugins.auth;
  const effectContext = entry?.initialized?.effectContext;
  const servicesTag = entry?.initialized?.plugin?.servicesTag;
  if (!effectContext || !servicesTag) return null;
  try {
    return EffectContext.get(effectContext as never, servicesTag as never) as AuthServices;
  } catch (error) {
    // A tag the context doesn't carry means the plugin's Effect copy diverged
    // from the host's (shared-dep negotiation failure) — say so loudly.
    logger.error(
      `[Auth] The auth plugin's servicesTag is not in its effectContext: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * A wedged Better Auth call must not pin its pool client (or the request)
 * forever: `/api/auth/*` is registered before the `/api/*` timeout middleware,
 * so the deadline lives here. On expiry the caller gets a 504 while the
 * underlying call keeps running — its DB work stays bounded by the pool's
 * connection-level timeouts instead.
 */
function parseAuthTimeoutMs(rawValue: string | undefined): number {
  if (rawValue === undefined || rawValue.trim() === "") return 30_000;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `[Auth] Invalid AUTH_TIMEOUT_MS="${rawValue}" — must be a positive number of milliseconds. Unset it to use the 30s default.`,
    );
  }
  return parsed;
}

const AUTH_TIMEOUT_MS = parseAuthTimeoutMs(process.env.AUTH_TIMEOUT_MS);

const authTimeoutResponse = () =>
  new Response(JSON.stringify({ error: "auth request timed out" }), {
    status: 504,
    headers: { "content-type": "application/json" },
  });

export function registerAuthHandler(app: Hono<HonoEnv>, plugins: PluginResult) {
  const services = getAuthServices(plugins);
  if (!services) {
    // Fail loud: an auth plugin that loaded but exposes no services silently
    // unmounts every /api/auth/* route — plain-text 404s that look like the
    // routes never existed. Name exactly which link is broken.
    if (plugins.auth) {
      logger.error(
        `[Auth] The auth plugin is loaded but its services are unresolvable — /api/auth/* is NOT mounted: ` +
          `effectContext=${plugins.auth.initialized?.effectContext ? "present" : "MISSING"}, ` +
          `servicesTag=${plugins.auth.initialized?.plugin?.servicesTag ? "present" : "MISSING"}, ` +
          `pluginName=${String(plugins.auth.initialized?.plugin?.id ?? plugins.auth.name ?? "unknown")}`,
      );
    }
    return;
  }
  app.on(["POST", "GET"], "/api/auth/*", (c) => {
    const pending = services.handler(c.req.raw);
    // Keep the rejection handled (no unhandled-rejection crash) while surfacing
    // the cause — this fires when the underlying call fails, including after
    // the 504 deadline already answered the caller.
    pending.catch((error) => {
      logger.error("[Auth] Auth handler rejected:", error);
    });
    return Effect.runPromise(
      Effect.promise(() => pending).pipe(
        Effect.timeout(`${AUTH_TIMEOUT_MS} millis`),
        Effect.catchTag("TimeoutError", () => Effect.succeed(authTimeoutResponse())),
      ),
    );
  });
}

export function createSessionMiddleware(plugins: PluginResult) {
  const authClientFactory = plugins.authClient;

  return async (c: Context<HonoEnv>, next: Next) => {
    if (c.req.path.startsWith("/api/auth/")) {
      return next();
    }

    c.set("reqHeaders", c.req.raw.headers);

    const rawClone = c.req.method === "GET" || c.req.method === "HEAD" ? null : c.req.raw.clone();
    let cachedRawBody: string | null = null;
    c.set("getRawBody", async () => {
      if (cachedRawBody !== null) return cachedRawBody;
      if (!rawClone) {
        cachedRawBody = "";
        return cachedRawBody;
      }
      cachedRawBody = await rawClone.text();
      return cachedRawBody;
    });

    if (!authClientFactory) {
      c.set("authContext", null);
      c.set("user", null);
      c.set("session", null);
      await next();
      return;
    }

    try {
      const authClient = authClientFactory({
        reqHeaders: Object.fromEntries(c.get("reqHeaders").entries()),
      }) as AuthClient;
      const [sessionResult, contextResult] = await Promise.all([
        authClient.getSession(),
        authClient.getContext(),
      ]);
      c.set("authContext", contextResult);
      c.set("user", sessionResult?.user ?? contextResult.user ?? null);
      c.set("session", sessionResult?.session ?? null);
    } catch (error) {
      console.warn(
        `[Auth] Session resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      c.set("authContext", null);
      c.set("user", null);
      c.set("session", null);
    }

    await next();
  };
}

export function buildPluginContext(c: Context<HonoEnv>): AuthPluginContext {
  const authContext = c.get("authContext");
  return {
    ...authContext,
    reqHeaders: c.get("reqHeaders"),
    getRawBody: c.get("getRawBody"),
  };
}

export type { HonoEnv };
