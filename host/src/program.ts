import { serve } from "@hono/node-server";
import {
  Cause,
  Clock,
  Config,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  Layer,
  ManagedRuntime,
  Option,
} from "effect";
import { suppressPgQueryQueueDeprecation } from "everything-dev/db";
import { slotPins } from "everything-dev/fingerprint";
import { type Context, Hono } from "hono";
import type { AuthVariables } from "./lib/auth";
import { getCspStrict, SecurityMiddleware } from "./middleware/security";
import { createStaticAssetProxyHandler } from "./middleware/static-proxy";
import { setupApiRoutes } from "./routes/api";
import type { HealthLoadingState } from "./routes/health";
import { createSsrFallbackHandler } from "./routes/ssr";
import { createSessionMiddleware, registerAuthHandler } from "./services/auth";
import { ConfigService, type RuntimeConfig } from "./services/config";
import { HostServerError } from "./services/errors";
import { FederationLifecycle } from "./services/federation.server";
import { closeMcpServer } from "./services/mcp";
import { PluginsService } from "./services/plugins";
import { deploymentFingerprint, RuntimeSnapshot } from "./services/runtime-snapshot";
import { SnapshotCoordinator } from "./services/snapshot-coordinator";
import { SnapshotWatch, watchIntervalMs } from "./services/snapshot-watch";
import { composeUi, isSsrAvailable, type UiComposeCacheState } from "./services/ui-compose";
import { extractErrorDetails } from "./utils/errors";
import { logger } from "./utils/logger";

type HonoEnv = { Variables: AuthVariables };

suppressPgQueryQueueDeprecation();

interface CompositionHealth {
  status: "disabled" | "composing" | "ready" | "failed";
  digest?: string;
  error?: string;
  /** Outcome of the post-listen self-probe — pending until it completes. */
  selfProbe?: { status: "pending" | "passed" | "failed"; error?: string };
}

/**
 * One serving state for boot and requests: requests capture ONE snapshot
 * state (config + both serving caches) and a swap flips readers atomically
 * (C7); boot composition warms the snapshot's own compose cache, so the boot
 * work is never re-done. Boot composition is awaited before /health
 * registers, so "composing" never reaches a response — and if it somehow
 * could, the honest answer is degraded, not ready.
 */
export const createStartServer = (onReady?: () => void) =>
  Effect.gen(function* () {
    const port = yield* Config.Number("PORT").pipe(Config.withDefault(3000));
    const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"));
    const isDev = nodeEnv !== "production";
    const CSP_STRICT = getCspStrict(isDev);

    const config = yield* ConfigService;
    const plugins = yield* PluginsService;
    const security = yield* SecurityMiddleware;
    yield* FederationLifecycle;
    const apiProxyMode = Boolean(config.api?.proxy);

    const ssrEnabled = isSsrAvailable(config);
    const compositionHealth: CompositionHealth = ssrEnabled
      ? { status: "composing" }
      : { status: "disabled" };

    const snapshot = yield* RuntimeSnapshot;
    const effectContext = yield* Effect.context();
    const getBaseConfig = async () =>
      (await Effect.runPromiseWith(effectContext)(snapshot.get)).config;
    const getServingState = () => Effect.runPromiseWith(effectContext)(snapshot.get);
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

    if (ssrEnabled) {
      const bootState = yield* snapshot.get;
      const boot = yield* Effect.exit(composeUi(config, bootState.composeState));
      if (Exit.isFailure(boot)) {
        const cause = Cause.squash(boot.cause);
        compositionHealth.status = "failed";
        compositionHealth.error = cause instanceof Error ? cause.message : String(cause);
        logger.error("[Server] Boot SSR composition FAILED — health stays degraded:", cause);
        if (!isDev) {
          logger.error("[Server] Exiting so the deploy rolls back");
          process.exit(1);
        }
      } else {
        compositionHealth.status = "ready";
        compositionHealth.digest = boot.value.digest;
        logger.info(`[Server] SSR composition ready (digest ${boot.value.digest})`);
      }
    }

    app.get("/health", (c: Context<HonoEnv>) => {
      const apiReady = apiProxyMode || Boolean(plugins.api?.router && plugins.status.available);
      const composeOk = !ssrEnabled || compositionHealth.status === "ready";
      const probeFailed = compositionHealth.selfProbe?.status === "failed";
      return c.json(
        {
          status:
            apiReady && composeOk && !probeFailed && compositionHealth.status !== "failed"
              ? "ready"
              : "degraded",
          api: apiProxyMode || plugins.api ? "ready" : "unavailable",
          auth: plugins.auth ? "ready" : "unavailable",
          ssr: compositionHealth,
          ...(plugins.status.error ? { error: plugins.status.error } : {}),
          ...(plugins.status.failures.length > 0 ? { failures: plugins.status.failures } : {}),
        },
        compositionHealth.status === "failed" ? 503 : 200,
      );
    });

    app.get("/.well-known/version", (c: Context<HonoEnv>) =>
      c.json(
        Effect.runPromiseWith(effectContext)(
          Effect.gen(function* () {
            const state = yield* snapshot.get;
            const watch = yield* Effect.serviceOption(SnapshotWatch);
            const lastOutcome = Option.isSome(watch) ? watch.value.lastOutcome : undefined;
            return {
              fingerprint: state.config.deploymentFingerprint ?? state.fingerprint,
              slots: state.pointer ? slotPins(state.pointer as never) : {},
              ...(lastOutcome !== undefined ? { watch: { lastOutcome } } : {}),
            };
          }),
        ),
        { headers: { "cache-control": "public, max-age=30" } },
      ),
    );

    app.get("/.well-known/mcp.json", (c: Context<HonoEnv>) => {
      const url = new URL(c.req.url);
      return c.json({
        name: `${config.title ?? config.account} MCP`,
        endpoint: `${url.origin}/api/mcp`,
        transport: "streamable-http",
        auth: {
          type: "api-key",
          header: "x-api-key",
          description:
            "Pass an API key via the x-api-key header. Create one at /settings/api-keys after signing in with your NEAR wallet.",
        },
        docs: `${url.origin}/api`,
        spec: `${url.origin}/api/spec.json`,
      });
    });

    const loadingState: HealthLoadingState = {
      status: "ready",
      startTime: yield* Clock.currentTimeMillis,
      milestones: [],
      error: null,
      ssrEnabled,
    };

    app.on(["GET", "HEAD"], "*", createStaticAssetProxyHandler(config, getBaseConfig));

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

    app.get("*", createSsrFallbackHandler(config, plugins, CSP_STRICT, getServingState));

    const startHttpServer = () => {
      const hostname = process.env.HOST || "0.0.0.0";

      const proxiedFetch: typeof app.fetch = (req, env, executionCtx) => {
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

        return app.fetch(req, env, executionCtx);
      };

      const server = serve({ fetch: proxiedFetch, port, hostname }, () => {
        logger.info(
          `[Server] Host ${isDev ? "dev" : "production"} server running at http://${hostname}:${port}`,
        );
        onReady?.();
        void (async () => {
          compositionHealth.selfProbe = { status: "pending" };
          try {
            const origin = `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}`;
            const [health, root] = await Promise.all([
              fetch(`${origin}/health`),
              ssrEnabled && compositionHealth.status === "ready"
                ? fetch(`${origin}/`)
                : Promise.resolve(null),
            ]);
            if (!health.ok) throw new Error(`self-probe /health returned ${health.status}`);
            if (root && !root.ok) throw new Error(`self-probe / returned ${root.status}`);
            if (root && !(await root.text()).includes("window.__RUNTIME_CONFIG__")) {
              throw new Error(
                "self-probe / rendered without the client bootstrap (window.__RUNTIME_CONFIG__)",
              );
            }
            compositionHealth.selfProbe = { status: "passed" };
            logger.info("[Server] Live self-probe passed");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            compositionHealth.selfProbe = { status: "failed", error: message };
            logger.error(
              "[Server] Live self-probe FAILED — the server accepted the connection but a root render failed:",
              error,
            );
          }
        })();
      });
      return server;
    };

    const httpServer = startHttpServer();

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.promise(() => closeMcpServer());
        yield* Effect.callback<void, never>((resume) => {
          logger.info("[Server] Closing HTTP server...");
          httpServer.close(() => {
            logger.info("[Server] HTTP server closed");
            resume(Effect.void);
          });
        });
      }),
    );

    return yield* Effect.never;
  });

export interface ServerInput {
  config: RuntimeConfig;
  port?: number;
  env?: Record<string, string>;
  /** Explicit server-scoped cache, primarily for integration fixtures. */
  composeCache?: UiComposeCacheState;
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
  input.config.deploymentFingerprint = deploymentFingerprint(input.config);
  const ConfigLive = Layer.succeed(ConfigService, input.config);
  const AppLive = Layer.provideMerge(PluginsService.Live, ConfigLive);
  const SnapshotLive = RuntimeSnapshot.layer(
    input.composeCache ? { composeState: input.composeCache } : undefined,
  ).pipe(Layer.provide(ConfigLive));
  const CoordinatorLive = SnapshotCoordinator.layer.pipe(Layer.provide(SnapshotLive));
  const WatchLive = SnapshotWatch.layer(watchIntervalMs()).pipe(
    Layer.provide(CoordinatorLive),
    Layer.provide(SnapshotLive),
    Layer.provide(ConfigLive),
  );
  const ServerLive = Layer.mergeAll(
    Layer.provideMerge(SecurityMiddleware.Live, AppLive),
    FederationLifecycle.layer,
    Layer.provideMerge(CoordinatorLive, SnapshotLive),
    WatchLive,
  );

  const runtime = ManagedRuntime.make(ServerLive);
  let programFiber: Fiber.Fiber<void, Config.ConfigError | HostServerError> | null = null;

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const serverEffect = createStartServer(() => resolveReady()).pipe(
      Effect.mapError((cause) => new HostServerError({ cause })),
    );

    const program = Effect.gen(function* () {
      const handle = yield* FiberHandle.make<void, HostServerError>();
      yield* FiberHandle.run(handle, serverEffect);
      yield* FiberHandle.join(handle);
    }).pipe(
      Effect.scoped,
      Effect.mapError((cause) => new HostServerError({ cause })),
    );

    const fiber = runtime.runFork(program);
    programFiber = fiber;

    fiber.addObserver((exit) => {
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
        rejectReady(Cause.squash(exit.cause));
      }
    });
  });

  const shutdown = async () => {
    logger.info("[Server] Shutting down...");

    if (programFiber) {
      await Effect.runPromise(
        Fiber.interrupt(programFiber).pipe(Effect.timeout("5 seconds"), Effect.ignore),
      );
    }

    await runtime.dispose();
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

  process.on("uncaughtException", (err) => {
    logger.error("[Server] Uncaught exception:", err);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("[Server] Unhandled rejection:", reason);
  });

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
