import type { Context, Hono, Next } from "hono";
import type { AuthClient, AuthPluginContext, AuthServices, AuthVariables } from "../lib/auth";
import type { PluginResult } from "./plugins";

type AuthMiddlewareEnv = { Variables: AuthVariables };

function getAuthServices(plugins: PluginResult): AuthServices | null {
  const entry = plugins.auth;
  if (!entry?.initialized?.context) return null;
  return entry.initialized.context as AuthServices;
}

export function registerAuthHandler(app: Hono<AuthMiddlewareEnv>, plugins: PluginResult) {
  const services = getAuthServices(plugins);
  if (!services) return;
  app.on(["POST", "GET"], "/api/auth/*", (c) => services.handler(c.req.raw));
}

export function createSessionMiddleware(plugins: PluginResult) {
  const authClientFactory = plugins.authClient;

  return async (c: Context<AuthMiddlewareEnv>, next: Next) => {
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

export function buildPluginContext(c: Context<AuthMiddlewareEnv>): AuthPluginContext {
  const authContext = c.get("authContext");
  return {
    ...(authContext ?? {}),
    reqHeaders: c.get("reqHeaders"),
    getRawBody: c.get("getRawBody"),
  };
}

export type { HonoEnv };
