import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { formatORPCError } from "every-plugin/errors";
import { onError } from "every-plugin/orpc";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { timeout } from "hono/timeout";
import type { AuthVariables } from "../lib/auth";
import { API_TIMEOUT_MS, BODY_LIMIT_MAX } from "../middleware/security";
import { proxyRequest } from "../middleware/static-proxy";
import { buildPluginContext, type createSessionMiddleware } from "../services/auth";
import type { RuntimeConfig } from "../services/config";
import { mountMcpRoute } from "../services/mcp";
import type { PluginResult } from "../services/plugins";
import { logger } from "../utils/logger";
import {
  getHealthStatus,
  getMemorySnapshot,
  HEALTH_PATH,
  type HealthLoadingState,
  MEMORY_PATH,
  tryGc,
} from "./health";

type HonoEnv = { Variables: AuthVariables };

function registerPublicRpcRouter(
  publicRpcRouters: Map<string, RPCHandler<any>>,
  prefix: string,
  router: unknown,
) {
  publicRpcRouters.set(
    prefix,
    new RPCHandler(router as any, {
      plugins: [new BatchHandlerPlugin()],
      interceptors: [
        onError((error: unknown) => {
          const formatted = formatORPCError(error);
          if (formatted) console.error(formatted);
          throw error;
        }),
      ],
    }),
  );
}

function getPublicRpcRoute(publicRpcRouters: Map<string, RPCHandler<any>>, pathname: string) {
  for (const [prefix, handler] of publicRpcRouters.entries()) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { prefix, handler };
    }
  }

  return null;
}

async function handleOrpc(
  c: Context<HonoEnv>,
  handler: RPCHandler<any> | OpenAPIHandler<any>,
  prefix: `/${string}`,
) {
  const context = buildPluginContext(c);

  const result = await handler.handle(c.req.raw, { prefix, context });
  if (!result.response) {
    return c.text("Not Found", 404);
  }

  const contentType = result.response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const nonce = c.get("secureHeadersNonce") as string | undefined;
    if (nonce) {
      const body = await result.response.text();
      const injected = body.replace(/<script/gi, `<script nonce="${nonce}"`);
      return c.html(injected, result.response.status as any);
    }
  }

  return c.newResponse(result.response.body, result.response);
}

export async function setupApiRoutes(
  app: Hono<HonoEnv>,
  config: RuntimeConfig,
  plugins: PluginResult,
  sessionMiddleware: ReturnType<typeof createSessionMiddleware>,
  loadingState: HealthLoadingState,
) {
  const apiConfig = config.api;

  if (!apiConfig) {
    throw new Error("API config is required to start the host");
  }

  const isProxyMode = process.argv.includes("--proxy");

  const publicRpcRouters = new Map<string, RPCHandler<any>>();

  if (plugins.auth?.router) {
    registerPublicRpcRouter(publicRpcRouters, "/api/rpc/auth", plugins.auth.router);
  }

  for (const [pluginKey, plugin] of Object.entries(plugins.plugins)) {
    registerPublicRpcRouter(publicRpcRouters, `/api/rpc/${pluginKey}`, plugin.router);
  }

  if (isProxyMode) {
    const proxyTarget = apiConfig.proxy!;
    logger.info(`[API] Proxy mode enabled → ${proxyTarget}`);

    app.all("/api/*", async (c: Context<HonoEnv>) => {
      if (c.req.path === HEALTH_PATH) {
        return c.json(getHealthStatus(plugins, loadingState));
      }
      if (c.req.path === MEMORY_PATH) {
        const gcRan = c.req.query("gc") === "true" && tryGc();
        return c.json({ memory: getMemorySnapshot(), gc: gcRan });
      }
      const response = await proxyRequest(c.req.raw, proxyTarget, true);
      return response;
    });

    return;
  }

  app.get(HEALTH_PATH, (c: Context<HonoEnv>) => {
    return c.json(getHealthStatus(plugins, loadingState));
  });

  app.get(MEMORY_PATH, (c: Context<HonoEnv>) => {
    const gcRan = c.req.query("gc") === "true" && tryGc();
    return c.json({ memory: getMemorySnapshot(), gc: gcRan });
  });

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: BODY_LIMIT_MAX,
      onError: (c) => c.json({ error: "Request body too large" }, 413),
    }),
  );

  app.use(
    "/api/*",
    timeout(API_TIMEOUT_MS, () => {
      return new HTTPException(408, { message: "Request timeout" });
    }),
  );

  app.use("/api/*", sessionMiddleware);

  const apiRouter = plugins.api?.router;

  if (!apiRouter) {
    const unavailable = (c: Context<HonoEnv>) =>
      c.json({ error: "Service Unavailable", message: "The API is currently unavailable." }, 503);

    app.all("/api/rpc", unavailable);
    app.all("/api/rpc/*", unavailable);
    app.all("/api", unavailable);
    app.all("/api/*", unavailable);
    return;
  }

  const rpcHandler = new RPCHandler(apiRouter as any, {
    plugins: [new BatchHandlerPlugin()],
    interceptors: [
      onError((error: unknown) => {
        const formatted = formatORPCError(error);
        if (formatted) console.error(formatted);
        throw error;
      }),
    ],
  });

  const apiHandler = new OpenAPIHandler(apiRouter as any, {
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
        specGenerateOptions: {
          info: {
            title: `${config.title ?? config.account} API`,
            version: "1.0.0",
          },
          servers: [{ url: "/api" }, { url: `${config.host?.url ?? ""}/api` }],
        },
      }),
    ],
    interceptors: [
      onError((error: unknown) => {
        const formatted = formatORPCError(error);
        if (formatted) console.error(formatted);
        throw error;
      }),
    ],
  });

  try {
    await mountMcpRoute(app, { apiRouter, apiHandler, config });
  } catch (error) {
    logger.warn(
      `[MCP] Failed to mount /api/mcp: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  app.all("/api/rpc", (c: Context<HonoEnv>) => handleOrpc(c, rpcHandler, "/api/rpc"));
  app.all("/api/rpc/*", (c: Context<HonoEnv>) => {
    const publicRoute = getPublicRpcRoute(publicRpcRouters, c.req.path);
    if (publicRoute) {
      return handleOrpc(c, publicRoute.handler, publicRoute.prefix as `/${string}`);
    }

    return handleOrpc(c, rpcHandler, "/api/rpc");
  });
  app.all("/api", (c: Context<HonoEnv>) => handleOrpc(c, apiHandler, "/api"));
  app.all("/api/*", (c: Context<HonoEnv>) => handleOrpc(c, apiHandler, "/api"));
}
