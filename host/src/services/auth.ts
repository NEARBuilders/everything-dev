import type { Context, Next } from "hono";
import type { AuthClient, AuthPluginContext, AuthServices, HonoEnv } from "../lib/auth";
import { toAuthClientContext } from "../lib/auth";
import type { HostPluginEntry, PluginResult } from "./plugins";

function resolveAuthEntry(plugins: PluginResult): HostPluginEntry | null {
  return plugins.auth ?? plugins.plugins.auth ?? null;
}

function getAuthServices(plugins: PluginResult): AuthServices | null {
  const entry = resolveAuthEntry(plugins);
  if (!entry?.initialized?.context) return null;
  return entry.initialized.context as AuthServices;
}

export function registerAuthHandler(app: { on: (...args: any[]) => any }, plugins: PluginResult) {
  const services = getAuthServices(plugins);
  if (!services) return;
  app.on(["POST", "GET"], "/api/auth/*", (c: Context<HonoEnv>) => services.handler(c.req.raw));
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
        reqHeaders: toAuthClientContext(c.get("reqHeaders")),
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
    ...(authContext ?? {}),
    reqHeaders: c.get("reqHeaders"),
    getRawBody: c.get("getRawBody"),
  };
}

export type { HonoEnv };
