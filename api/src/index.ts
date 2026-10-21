import { ORPCError } from "@orpc/server";
import { Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { ContextSchema } from "./lib/context";
import { DeployHistoryService } from "./lib/deploy-history";
import type { PluginsClient } from "./lib/plugins-types.gen";

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({}),

  secrets: z.object({
    API_DATABASE_URL: z
      .string()
      .default("pglite:.bos/api/:memory:")
      .describe("Database connection string. Use pglite: for local, postgres:// for production."),
  }),

  context: ContextSchema,

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("[API] Initialized");
      return Layer.mergeAll(DatabaseLive(config), DeployHistoryService.layer);
    }),

  createRouter: (builder, plugins) => {
    const requireAuthOrApiKey = builder.middleware(async ({ context, next }) => {
      if (!context.user && !context.userId && !context.apiKey) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { apiKeyProvided: Boolean(context.apiKey) },
        });
      }
      return next({ context });
    });

    const router = {
      ping: builder.ping.handler(async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
      })),

      testError: builder.testError.handler(async ({ input }) => {
        switch (input.kind) {
          case "unauthorized":
            throw new ORPCError("UNAUTHORIZED", {
              message: "test unauthorized error",
            });
          case "forbidden":
            throw new ORPCError("FORBIDDEN", {
              message: "test forbidden error",
            });
          case "not_found":
            throw new ORPCError("NOT_FOUND", {
              message: "test not found error",
            });
          case "conflict":
            throw new ORPCError("CONFLICT", { message: "test conflict error" });
          case "bad_request":
            throw new ORPCError("BAD_REQUEST", { message: "test bad request error" });
          default:
            throw new Error("test internal server error");
        }
      }),

      hosting: {
        listDeploys: builder.hosting.listDeploys.use(requireAuthOrApiKey).effect(function* ({
          input,
          errors,
        }) {
          const history = yield* DeployHistoryService;
          const deploys = yield* history.listDeploys(input).pipe(
            Effect.mapError((error) =>
              errors.CONNECTION_ERROR({
                message: error.message,
                data: { errorCode: "fastkv_history_read_failed" },
              }),
            ),
          );
          return { deploys };
        }),
      },
    };

    const templateRouter = (plugins as Record<string, { router?: unknown } | undefined>).template
      ?.router;
    if (templateRouter) {
      (router as Record<string, unknown>).things = templateRouter;
    }

    return router;
  },
});
