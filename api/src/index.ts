import { ORPCError } from "@orpc/server";
import { Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { ContextSchema } from "./lib/context";
import { DeployHistoryService } from "./lib/deploy-history";
import type { PluginsClient } from "./lib/plugins-types.gen";
import { ReconcilerDisabled, ReconcilerLive, ReconcilerService } from "./lib/reconciler";
import {
  isValidSecretName,
  SecretsStore,
  type SecretsStoreError,
  SecretsStoreLive,
} from "./lib/secrets-store";

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({
    hosting: z
      .object({
        reconciler: z
          .object({
            watch: z
              .array(
                z.object({
                  account: z.string().min(1).describe("Runtime account (NEAR account id)"),
                  gateway: z.string().min(1).describe("Runtime gateway id (its public domain)"),
                  instance: z
                    .string()
                    .min(1)
                    .optional()
                    .describe("Override the derived instance name"),
                  image: z
                    .string()
                    .min(1)
                    .optional()
                    .describe("Explicit image — overrides the platform-manifest pin in force"),
                }),
              )
              .default([])
              .describe(
                "Platform-hosted namespaces to converge. Never include the runtime this api shell runs in.",
              ),
            pollIntervalMs: z
              .number()
              .int()
              .min(1000)
              .max(600000)
              .default(15000)
              .describe("Bounded poll cadence for fingerprint checks"),
          })
          .optional()
          .describe(
            "Reconciler (plan 055 ticket 08): converges hosted instances to each namespace's latest published fingerprint via the hosting adapter. Requires the alchemy optional peer for the docker adapter.",
          ),
      })
      .optional(),
  }),

  secrets: z.object({
    API_DATABASE_URL: z
      .string()
      .default("pglite:.bos/api/:memory:")
      .describe("Database connection string. Use pglite: for local, postgres:// for production."),
    BETTER_AUTH_SECRET: z
      .string()
      .describe(
        "Platform root secret — the secrets vault derives each runtime's KEK from it (HKDF, runtime-scoped salt).",
      ),
  }),

  context: ContextSchema,

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("[API] Initialized");
      const base = Layer.mergeAll(
        DeployHistoryService.layer,
        SecretsStoreLive(config.secrets.BETTER_AUTH_SECRET).pipe(
          Layer.provideMerge(DatabaseLive(config)),
        ),
      );
      const reconciler = config.variables.hosting?.reconciler;
      const watch = reconciler?.watch ?? [];
      if (watch.length === 0) {
        return Layer.mergeAll(base, ReconcilerDisabled);
      }
      const docker = yield* Effect.promise(() => import("everything-dev/hosting/docker")).pipe(
        Effect.mapError(
          () =>
            new Error(
              "The reconciler watch list is configured but the docker hosting adapter's optional peer is missing — install alchemy in the api workspace",
            ),
        ),
      );
      return ReconcilerLive(
        { watch, pollIntervalMs: reconciler?.pollIntervalMs ?? 15000 },
        config.secrets.API_DATABASE_URL,
      ).pipe(
        Layer.provideMerge(docker.dockerHostingAdapterLayer({ adopt: true })),
        Layer.provideMerge(base),
      );
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

        reconcilerStatus: builder.hosting.reconcilerStatus
          .use(requireAuthOrApiKey)
          .effect(function* () {
            const reconciler = yield* ReconcilerService;
            return yield* reconciler.status();
          }),
      },

      secrets: {
        set: builder.secrets.set.use(requireAuthOrApiKey).effect(function* ({
          input,
          errors,
          context,
        }) {
          if (!isValidSecretName(input.name)) {
            return yield* Effect.fail(
              errors.BAD_REQUEST({
                message:
                  "Secret name must be UPPER_SNAKE_CASE; BOS_* and PORT are reserved (the platform composes them)",
                data: {},
              }),
            );
          }
          const store = yield* SecretsStore;
          const result = yield* store
            .set({
              account: input.account,
              gateway: input.gateway,
              name: input.name,
              value: input.value,
              setBy: context.user?.id ?? context.apiKey?.id ?? undefined,
            })
            .pipe(
              Effect.mapError((error: SecretsStoreError) =>
                errors.CONNECTION_ERROR({
                  message: error.message,
                  data: { errorCode: "secrets_store_failed" },
                }),
              ),
            );
          return result;
        }),

        list: builder.secrets.list.use(requireAuthOrApiKey).effect(function* ({ input, errors }) {
          const store = yield* SecretsStore;
          return yield* store
            .list({ account: input.account, gateway: input.gateway, declared: input.declared })
            .pipe(
              Effect.mapError((error: SecretsStoreError) =>
                errors.CONNECTION_ERROR({
                  message: error.message,
                  data: { errorCode: "secrets_store_failed" },
                }),
              ),
            );
        }),

        remove: builder.secrets.remove.use(requireAuthOrApiKey).effect(function* ({
          input,
          errors,
        }) {
          const store = yield* SecretsStore;
          return yield* store
            .remove({ account: input.account, gateway: input.gateway, name: input.name })
            .pipe(
              Effect.mapError((error: SecretsStoreError) =>
                errors.CONNECTION_ERROR({
                  message: error.message,
                  data: { errorCode: "secrets_store_failed" },
                }),
              ),
            );
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
