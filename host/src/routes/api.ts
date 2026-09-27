import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin, ResponseHeadersHandlerPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { Context as EffectContext } from "effect";
import { formatORPCError, PLUGIN_ERROR_STATUS_MAP } from "every-plugin/errors";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { timeout } from "hono/timeout";
import type { AuthVariables } from "../lib/auth";
import { API_TIMEOUT_MS, BODY_LIMIT_MAX, bundleUploadBodyLimitBytes } from "../middleware/security";
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
  publicRpcRouters: Map<string, { handler: RPCHandler<any>; effectContext: unknown }>,
  prefix: string,
  router: unknown,
  effectContext: unknown,
) {
  publicRpcRouters.set(prefix, {
    handler: new RPCHandler(router as any, {
      errorStatusMap: PLUGIN_ERROR_STATUS_MAP,
      plugins: [new BatchHandlerPlugin()],
      interceptors: [
        onError((error: unknown) => {
          const formatted = formatORPCError(error);
          if (formatted) console.error(formatted);
          throw error;
        }),
      ],
    }),
    effectContext,
  });
}

function getPublicRpcRoute(
  publicRpcRouters: Map<string, { handler: RPCHandler<any>; effectContext: unknown }>,
  pathname: string,
) {
  for (const [prefix, entry] of publicRpcRouters.entries()) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { prefix, handler: entry.handler, effectContext: entry.effectContext };
    }
  }

  return null;
}

async function handleOrpc(
  c: Context<HonoEnv>,
  handler: RPCHandler<any> | OpenAPIHandler<any>,
  prefix: `/${string}`,
  effectContext: unknown,
) {
  const context = {
    ...buildPluginContext(c),
    "effect/context": effectContext,
  };

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

  const publicRpcRouters = new Map<string, { handler: RPCHandler<any>; effectContext: unknown }>();

  const allEntries = [plugins.auth, plugins.api, ...Object.values(plugins.plugins)].filter(
    (entry): entry is NonNullable<typeof entry> => Boolean(entry),
  );
  let mergedEffectContext: unknown = EffectContext.empty();
  for (const entry of allEntries) {
    const entryEffectContext = entry.initialized?.effectContext;
    if (entryEffectContext) {
      mergedEffectContext = EffectContext.merge(
        mergedEffectContext as never,
        entryEffectContext as never,
      );
    }
  }

  if (plugins.auth?.router) {
    registerPublicRpcRouter(
      publicRpcRouters,
      "/api/rpc/auth",
      plugins.auth.router,
      plugins.auth.initialized?.effectContext,
    );
  }

  for (const [pluginKey, plugin] of Object.entries(plugins.plugins)) {
    registerPublicRpcRouter(
      publicRpcRouters,
      `/api/rpc/${pluginKey}`,
      plugin.router,
      plugin.initialized?.effectContext,
    );
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

  const apiBodyLimit = bodyLimit({
    maxSize: BODY_LIMIT_MAX,
    onError: (c) => c.json({ error: "Request body too large" }, 413),
  });

  // Route-scoped limit for bundle uploads (ADR 0015/0020): the global
  // /api/* limit skips the path — Hono runs every matching middleware, so
  // two limits would compose to the smaller ceiling.
  const STORAGE_BUNDLE_PATH = "/api/storage/bundles";
  const storageBodyLimit = bodyLimit({
    maxSize: Math.ceil(bundleUploadBodyLimitBytes()),
    onError: (c) => c.json({ error: "Bundle upload too large" }, 413),
  });
  app.use(STORAGE_BUNDLE_PATH, storageBodyLimit);
  app.use("/api/*", (c, next) => {
    if (c.req.path === STORAGE_BUNDLE_PATH) return next();
    return apiBodyLimit(c, next);
  });

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
      c.json(
        {
          error: "Service Unavailable",
          message: "The API is currently unavailable.",
          ...(plugins.status.error ? { detail: plugins.status.error } : {}),
          ...(plugins.status.errorDetails ? { detailFull: plugins.status.errorDetails } : {}),
          ...(plugins.status.loadedPlugins.length > 0
            ? { loadedPlugins: plugins.status.loadedPlugins }
            : {}),
        },
        503,
      );

    app.all("/api/rpc", unavailable);
    app.all("/api/rpc/*", unavailable);
    app.all("/api", unavailable);
    app.all("/api/*", unavailable);
    return;
  }

  const rpcHandler = new RPCHandler(apiRouter as any, {
    errorStatusMap: PLUGIN_ERROR_STATUS_MAP,
    plugins: [new BatchHandlerPlugin()],
    interceptors: [
      onError((error: unknown) => {
        const formatted = formatORPCError(error);
        if (formatted) console.error(formatted);
        throw error;
      }),
    ],
  });

  const openApiGenerator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });

  const apiHandler = new OpenAPIHandler(apiRouter as any, {
    errorStatusMap: PLUGIN_ERROR_STATUS_MAP,
    plugins: [
      new ResponseHeadersHandlerPlugin(),
      new OpenAPIReferenceHandlerPlugin({
        spec: () =>
          openApiGenerator.generate(apiRouter as any, {
            version: "3.1.1",
            base: {
              info: {
                title: `${config.title ?? config.account} API`,
                version: "1.0.0",
              },
              servers: [{ url: "/api" }, { url: `${config.host?.url ?? ""}/api` }],
            },
          }),
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
    await mountMcpRoute(app, { apiRouter, apiHandler, config, effectContext: mergedEffectContext });
  } catch (error) {
    logger.warn(
      `[MCP] Failed to mount /api/mcp: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  app.all("/api/rpc", (c: Context<HonoEnv>) =>
    handleOrpc(c, rpcHandler, "/api/rpc", mergedEffectContext),
  );
  app.all("/api/rpc/*", (c: Context<HonoEnv>) => {
    const publicRoute = getPublicRpcRoute(publicRpcRouters, c.req.path);
    if (publicRoute) {
      return handleOrpc(
        c,
        publicRoute.handler,
        publicRoute.prefix as `/${string}`,
        publicRoute.effectContext,
      );
    }

    return handleOrpc(c, rpcHandler, "/api/rpc", mergedEffectContext);
  });
  app.all("/api", (c: Context<HonoEnv>) => handleOrpc(c, apiHandler, "/api", mergedEffectContext));
  app.all("/api/*", (c: Context<HonoEnv>) =>
    handleOrpc(c, apiHandler, "/api", mergedEffectContext),
  );
}
