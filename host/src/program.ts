import { serve } from "@hono/node-server";
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  Layer,
  ManagedRuntime,
} from "every-plugin/effect";
import { getBaseStyles, getHydrateScript, getThemeInitScript } from "everything-dev/ui/head";
import { type Context, Hono } from "hono";
import type { AuthVariables } from "./lib/auth";
import { getCspStrict, SecurityMiddleware, STATIC_ASSET_PATTERN } from "./middleware/security";
import { proxyStaticAssetRequest } from "./middleware/static-proxy";
import { setupApiRoutes } from "./routes/api";
import type { HealthLoadingState } from "./routes/health";
import { buildPluginContext, createSessionMiddleware, registerAuthHandler } from "./services/auth";
import { type ClientRuntimeConfig, ConfigService, type RuntimeConfig } from "./services/config";
import { loadRouterModule, resetFederationInstance } from "./services/federation.server";
import { startIntegrityMonitor } from "./services/integrity-monitor";
import { closeMcpServer } from "./services/mcp";
import { createPluginsClient, type PluginResult, PluginsService } from "./services/plugins";
import { getTenantRuntimeErrorResponse, resolveRequestRuntime } from "./services/tenant-runtime";
import type { RouterModule, RuntimePlugin } from "./types";
import { extractErrorDetails } from "./utils/errors";
import { logger } from "./utils/logger";
import { normalizeUrl } from "./utils/normalize";

type HonoEnv = { Variables: AuthVariables };

type ActiveRuntimeState = NonNullable<ClientRuntimeConfig["runtime"]>;

type RuntimeClientConfig = ClientRuntimeConfig & { runtime?: ActiveRuntimeState };

function getFallbackGatewayId(config: RuntimeConfig) {
  if (config.domain) {
    return config.domain;
  }

  return normalizeUrl(config.host?.url)?.replace(/^https?:\/\//, "") ?? "runtime";
}

function resolveActiveRuntime(config: RuntimeConfig, request: Request) {
  const url = new URL(request.url);
  const fallbackGatewayId = getFallbackGatewayId(config);
  return {
    accountId: config.account,
    gatewayId: fallbackGatewayId,
    runtimeBasePath: "/",
    title: config.title ?? config.account,
    description: config.description ?? null,
    hostUrl: url.origin,
  } satisfies ActiveRuntimeState;
}

function buildRuntimeClientConfig(
  config: RuntimeConfig,
  request: Request,
  activeRuntime: ActiveRuntimeState,
  plugins: PluginResult,
): RuntimeClientConfig {
  const requestUrl = new URL(request.url);
  const uiConfig = config.ui;

  if (!uiConfig) {
    throw new Error("UI config is required to build the runtime client config");
  }

  return {
    env: config.env,
    account: activeRuntime.accountId,
    networkId: config.account.endsWith(".testnet") ? "testnet" : "mainnet",
    hostUrl: requestUrl.origin,
    assetsUrl: uiConfig.url,
    apiBase: "/api",
    rpcBase: "/api/rpc",
    authAvailable: plugins.auth !== null,
    repository: config.repository,
    ui: {
      name: uiConfig.name,
      url: uiConfig.url,
      entry: uiConfig.entry,
      integrity: uiConfig.integrity,
    },
    api: config.api
      ? {
          name: config.api.name,
          url: config.api.url,
          entry: config.api.entry,
          integrity: config.api.integrity,
          ...(config.api.variables ? { variables: config.api.variables } : {}),
        }
      : undefined,
    auth: config.auth
      ? {
          name: config.auth.name,
          url: config.auth.url,
          entry: config.auth.entry,
          integrity: config.auth.integrity,
          ...(config.auth.variables ? { variables: config.auth.variables } : {}),
        }
      : undefined,
    plugins: Object.fromEntries(
      (Object.entries(config.plugins ?? {}) as Array<[string, RuntimePlugin]>).map(
        ([key, plugin]) => [
          key,
          {
            name: plugin.name,
            url: plugin.url,
            entry: plugin.entry,
            integrity: plugin.integrity,
            ...(plugin.variables ? { variables: plugin.variables } : {}),
            ...(plugin.ui
              ? {
                  ui: {
                    name: plugin.ui.name,
                    url: plugin.ui.url,
                    entry: plugin.ui.entry,
                    source: plugin.ui.source,
                    integrity: plugin.ui.integrity,
                  },
                }
              : {}),
          },
        ],
      ),
    ),
    runtime: activeRuntime,
  } as RuntimeClientConfig;
}

export const createStartServer = (onReady?: () => void) =>
  Effect.gen(function* () {
    const port = Number(process.env.PORT) || 3000;
    const isDev = process.env.NODE_ENV !== "production";
    const CSP_STRICT = getCspStrict(isDev);

    const config = yield* ConfigService;
    const uiConfig = config.ui!;
    const plugins = yield* PluginsService;
    const security = yield* SecurityMiddleware;

    const app = new Hono<HonoEnv>();

    app.onError((err: unknown, c: Context<HonoEnv>) => {
      const details = extractErrorDetails(err);
      logger.error(`[Hono Error] ${c.req.method} ${c.req.path}`);
      logger.error(`[Hono Error] Message: ${details.message}`);
      if (details.cause) {
        logger.error(`[Hono Error] Cause: ${details.cause}`);
      }
      if (details.stack) {
        logger.error(`[Hono Error] Stack:\n${details.stack}`);
      }
      return c.json({ error: details.message, cause: details.cause }, 500);
    });

    app.use("/*", security.cors);
    app.use("/*", security.csrf);
    app.use("/*", security.rateLimit);
    app.use("*", security.csp);

    app.get("/health", (c: Context<HonoEnv>) => c.text("OK"));

    const loadingState: HealthLoadingState = {
      status: "ready",
      startTime: Date.now(),
      milestones: [],
      error: null,
      ssrEnabled: Boolean(uiConfig.ssrUrl),
    };

    const renderClientShell = (
      ctx: Context<HonoEnv>,
      runtimeSourceConfig: RuntimeConfig,
      runtimeConfig: ClientRuntimeConfig,
      error?: Error | null,
    ) => {
      const nonce = CSP_STRICT ? ctx.get("secureHeadersNonce") : undefined;
      const uiIntegrity = runtimeSourceConfig.ui.integrity;
      const assetsUrl = runtimeConfig.assetsUrl.replace(/\/$/, "");
      const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
      const sriAttr = uiIntegrity ? ` integrity="${uiIntegrity}" crossorigin="anonymous"` : "";
      const uiVersion = uiIntegrity ? `?v=${encodeURIComponent(uiIntegrity)}` : "";

      const baseStyles = `
        ${getBaseStyles()}
        .shell { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; }
        .fade { animation: fadeIn 0.3s ease-in; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .error { color: #fca5a5; }
      `.trim();

      const themeScript = `<script${nonceAttr}>${(getThemeInitScript() as { children?: string }).children ?? ""}</script>`;

      const shellBody = `<div id="root"><div class="shell"><div class="fade">${
        error
          ? `<p class="error">SSR unavailable, showing client app.</p><p>${error.message}</p>`
          : `<p>Loading...</p>`
      }</div></div></div>`;

      const title =
        runtimeConfig.runtime?.title ?? runtimeSourceConfig.title ?? runtimeSourceConfig.account;
      const hydrateScript =
        (
          getHydrateScript(
            runtimeConfig as Partial<ClientRuntimeConfig>,
            undefined,
            undefined,
            nonce,
          ) as { children?: string }
        ).children ?? "";

      return ctx.html(
        `<!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
              <title>${title}</title>
              <link rel="manifest" href="${assetsUrl}/site.webmanifest" />
              <link rel="stylesheet" href="${assetsUrl}/static/css/style.css${uiVersion}" />
              <style>${baseStyles}</style>
              ${themeScript}
              <script${nonceAttr} src="${assetsUrl}/remoteEntry.js${uiVersion}"${sriAttr}></script>
              <script${nonceAttr}>${hydrateScript}</script>
            </head>
            <body>${shellBody}</body>
          </html>`,
        200,
      );
    };

    const proxyUiAssetRequest = async (c: Context<HonoEnv>) => {
      const runtime = await resolveRequestRuntime(config, c.req.raw, {
        verification: "stale-while-revalidate",
      });
      return await proxyStaticAssetRequest(c.req.raw, runtime.config.ui.url);
    };

    const sessionMiddleware = createSessionMiddleware(plugins);

    if (isDev) {
      app.use("/api/auth/*", async (c, next) => {
        await next();
        const setCookie = c.res.headers.get("set-cookie");
        if (setCookie) {
          c.res.headers.set("set-cookie", setCookie.replace(/;\s*Secure/gi, ""));
        }
      });
    }

    registerAuthHandler(app, plugins);
    yield* Effect.promise(() =>
      setupApiRoutes(app, config, plugins, sessionMiddleware, loadingState),
    );

    app.on(["GET", "HEAD"], "*", async (c: Context<HonoEnv>, next) => {
      const { pathname } = new URL(c.req.url);

      if (
        pathname === "/" ||
        pathname === "/api" ||
        pathname.startsWith("/api/") ||
        pathname === "/health"
      ) {
        return next();
      }

      const lastSegment = pathname.split("/").pop() ?? "";
      if (!STATIC_ASSET_PATTERN.test(lastSegment)) {
        return next();
      }

      try {
        return await proxyUiAssetRequest(c);
      } catch (error) {
        const { message, status } = getTenantRuntimeErrorResponse(error);
        logger.error(`[Proxy Asset] ${c.req.method} ${c.req.path} — ${message}`);
        return c.text(message, { status: status as 404 | 500 | 502 });
      }
    });

    app.use("/*", sessionMiddleware);

    app.get("*", async (c: Context<HonoEnv>) => {
      if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
        return c.notFound();
      }

      let resolvedRuntime: Awaited<ReturnType<typeof resolveRequestRuntime>>;
      try {
        resolvedRuntime = await resolveRequestRuntime(config, c.req.raw, {
          verification: "blocking",
        });
      } catch (error) {
        const { message, status } = getTenantRuntimeErrorResponse(error);
        logger.error(`[SSR] ${c.req.method} ${c.req.path} — ${message}`);
        return c.text(message, { status: status as 404 | 500 | 502 });
      }

      const effectiveConfig = resolvedRuntime.config;
      const activeRuntime = await resolveActiveRuntime(effectiveConfig, c.req.raw);
      const nonce = CSP_STRICT ? c.get("secureHeadersNonce") : undefined;
      const runtimeConfig = buildRuntimeClientConfig(
        effectiveConfig,
        c.req.raw,
        activeRuntime,
        plugins,
      );

      let ssrRouterModule: RouterModule | null = null;
      let moduleLoadError: Error | null = null;

      if (effectiveConfig.ui.ssrUrl) {
        const result = await Effect.runPromise(
          loadRouterModule(effectiveConfig).pipe(Effect.either),
        );
        if (result._tag === "Right") {
          ssrRouterModule = result.right;
        } else {
          moduleLoadError = result.left;
          logger.error("[SSR] Failed to load Router module:", moduleLoadError);
        }
      }

      if (ssrRouterModule && effectiveConfig.ui.ssrUrl) {
        try {
          const pluginContext = buildPluginContext(c);
          const ssrApiClient = createPluginsClient(plugins, pluginContext);

          const render = () =>
            ssrRouterModule.renderToStream(c.req.raw, {
              session: c.get("session") ? { session: c.get("session"), user: c.get("user") } : null,
              basepath: runtimeConfig.runtime?.runtimeBasePath,
              runtimeConfig,
              apiClient: ssrApiClient,
              cspNonce: nonce,
            });

          const result = await render();
          const responseHeaders = new Headers(result?.headers);
          const cspHeader = c.res.headers.get("Content-Security-Policy");
          if (cspHeader) {
            responseHeaders.set("Content-Security-Policy", cspHeader);
          }
          return new Response(result?.stream, {
            status: result?.statusCode,
            headers: responseHeaders,
          });
        } catch (error) {
          logger.error("[SSR] Streaming error:", error);
          moduleLoadError = error as Error;
        }
      }

      return renderClientShell(c, effectiveConfig, runtimeConfig, moduleLoadError);
    });

    const startHttpServer = () => {
      const hostname = process.env.HOST || "0.0.0.0";

      const proxiedFetch = (req: Request): Response | Promise<Response> => {
        const url = new URL(req.url);
        const forwardedProto = req.headers.get("x-forwarded-proto");
        const forwardedHost = req.headers.get("x-forwarded-host");

        if (forwardedProto) {
          url.protocol = forwardedProto;
        }
        if (forwardedHost) {
          url.host = forwardedHost;
        }

        if (forwardedProto || forwardedHost) {
          req = new Request(url, req);
        }

        return app.fetch(req);
      };

      const server = serve({ fetch: proxiedFetch, port, hostname }, () => {
        logger.info(
          `[Server] Host ${isDev ? "dev" : "production"} server running at http://${hostname}:${port}`,
        );
        onReady?.();
      });
      return server;
    };

    const httpServer = startHttpServer();

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.promise(() => closeMcpServer());
        yield* Effect.async<void, never>((resume) => {
          logger.info("[Server] Closing HTTP server...");
          httpServer.close(() => {
            logger.info("[Server] HTTP server closed");
            resume(Effect.void);
          });
        });
      }),
    );

    yield* Effect.never;
  });

export interface ServerInput {
  config: RuntimeConfig;
  port?: number;
  env?: Record<string, string>;
}

export interface ServerHandle {
  ready: Promise<void>;
  shutdown: () => Promise<void>;
}

export const runServer = (input: ServerInput): ServerHandle => {
  if (input.port != null) {
    process.env.PORT = String(input.port);
  }
  if (input.env) {
    for (const [key, value] of Object.entries(input.env)) {
      process.env[key] = value;
    }
  }
  const ConfigLive = Layer.succeed(ConfigService, input.config);
  const AppLive = Layer.provideMerge(PluginsService.Live, ConfigLive);
  const ServerLive = Layer.provideMerge(SecurityMiddleware.Live, AppLive);

  const stopMonitor = startIntegrityMonitor(input.config);

  const runtime = ManagedRuntime.make(ServerLive);
  let programFiber: Fiber.RuntimeFiber<void, unknown> | null = null;

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const serverEffect = createStartServer(() => resolveReady());

    const program = Effect.gen(function* () {
      const handle = yield* FiberHandle.make();
      yield* FiberHandle.run(handle, serverEffect);
      yield* FiberHandle.join(handle);
    }).pipe(Effect.scoped);

    programFiber = runtime.runFork(program);

    programFiber.addObserver((exit) => {
      if (Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)) {
        rejectReady(Cause.squash(exit.cause));
      }
    });
  });

  const shutdown = async () => {
    logger.info("[Server] Shutting down...");
    stopMonitor();

    if (programFiber) {
      await Effect.runPromise(
        Fiber.interrupt(programFiber).pipe(
          Effect.timeout("5 seconds"),
          Effect.catchAll(() => Effect.void),
        ),
      );
    }

    await runtime.dispose();
    resetFederationInstance();
    logger.info("[Server] Shutdown complete");
  };

  return { ready, shutdown };
};

export const runServerBlocking = async (input: ServerInput) => {
  const handle = runServer(input);

  const forceExit = () => {
    logger.info("\n[Server] Force exit");
    process.exit(0);
  };

  const gracefulShutdown = () => {
    const timeout = setTimeout(forceExit, 5000);
    handle
      .shutdown()
      .then(() => {
        clearTimeout(timeout);
        process.exit(0);
      })
      .catch(() => {
        clearTimeout(timeout);
        process.exit(1);
      });
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  try {
    await handle.ready;
    await new Promise(() => {});
  } catch (err) {
    logger.error("[Server] Failed to start:", err);
    process.exit(1);
  }
};
