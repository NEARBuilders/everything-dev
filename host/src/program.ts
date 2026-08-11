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
import { type Context, Hono } from "hono";
import type { AuthVariables } from "./lib/auth";
import { getCspStrict, SecurityMiddleware } from "./middleware/security";
import { createStaticAssetProxyHandler } from "./middleware/static-proxy";
import { setupApiRoutes } from "./routes/api";
import type { HealthLoadingState } from "./routes/health";
import { createSsrFallbackHandler } from "./routes/ssr";
import { createSessionMiddleware, registerAuthHandler } from "./services/auth";
import { ConfigService, type RuntimeConfig } from "./services/config";
import { resetFederationInstance } from "./services/federation.server";
import { startIntegrityMonitor } from "./services/integrity-monitor";
import { closeMcpServer } from "./services/mcp";
import { PluginsService } from "./services/plugins";
import { extractErrorDetails } from "./utils/errors";
import { logger } from "./utils/logger";

type HonoEnv = { Variables: AuthVariables };

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

    app.on(["GET", "HEAD"], "*", createStaticAssetProxyHandler(config));

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

    app.use("/*", sessionMiddleware);

    app.get("*", createSsrFallbackHandler(config, plugins, CSP_STRICT));

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
