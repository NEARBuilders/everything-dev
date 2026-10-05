import { ORPCError } from "@orpc/server";
import { Cause, Effect, Exit, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { ContextSchema } from "./lib/context";
import type { PluginsClient } from "./lib/plugins-types.gen";
import {
  buildBundleKey,
  bundleCacheControl,
  bundleContentType,
  computeObjectIntegrity,
  maxBundleUploadBytes,
  StorageLive,
  StorageTag,
  validateNamespacePart,
  validateObjectPath,
  validateUploadSize,
} from "./services/storage";

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
      return Layer.mergeAll(DatabaseLive(config.secrets.API_DATABASE_URL), StorageLive);
    }),

  createRouter: (builder, plugins) => {
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

      uploadStorageBundle: builder.uploadStorageBundle.effect(function* ({
        input,
        context,
        errors,
      }) {
        const storage = yield* StorageTag;

        if (!context.user && !context.userId && !context.apiKey) {
          return yield* Effect.fail(
            errors.UNAUTHORIZED({
              message: "Authentication required — sign in or provide an API key",
              data: { apiKeyProvided: Boolean(context.apiKey) },
            }),
          );
        }

        const invalidFields = [
          !validateNamespacePart(input.account, "account") ? "account" : null,
          !validateNamespacePart(input.gateway, "gateway") ? "gateway" : null,
          !validateNamespacePart(input.workspace, "workspace") ? "workspace" : null,
        ].filter((field): field is string => field !== null);
        if (invalidFields.length > 0) {
          return yield* Effect.fail(
            errors.BAD_REQUEST({
              message: "Invalid bundle namespace",
              data: { invalidFields },
            }),
          );
        }

        const principal = context.near?.primaryAccountId ?? null;
        const isSession = Boolean(context.user || context.userId);
        if (isSession && !principal) {
          return yield* Effect.fail(
            errors.FORBIDDEN({
              message: "Link a NEAR account to your session to publish bundles",
              data: { action: "storage.bundles.write" },
            }),
          );
        }
        if (principal && principal !== input.account) {
          return yield* Effect.fail(
            errors.FORBIDDEN({
              message: `Bundle uploads are pinned to the authenticated account (${principal})`,
              data: { action: "storage.bundles.write" },
            }),
          );
        }

        const maxBytes = maxBundleUploadBytes();
        const decoded: Array<{ objectPath: string; name: string; bytes: Uint8Array }> = [];
        for (const file of input.files) {
          const objectPath = validateObjectPath(file.path);
          if (!objectPath) {
            return yield* Effect.fail(
              errors.BAD_REQUEST({
                message: `Invalid bundle object path: ${file.path}`,
                data: { invalidFields: ["files"] },
              }),
            );
          }
          const buffer = Buffer.from(file.contentBase64, "base64");
          if (buffer.length === 0) {
            return yield* Effect.fail(
              errors.BAD_REQUEST({
                message: `Empty bundle file: ${file.path}`,
                data: { invalidFields: ["files"] },
              }),
            );
          }
          decoded.push({
            objectPath,
            name: objectPath.split("/").pop() ?? objectPath,
            bytes: new Uint8Array(buffer),
          });
        }

        const totalBytes = decoded.reduce((sum, file) => sum + file.bytes.byteLength, 0);
        if (!validateUploadSize(decoded, maxBytes)) {
          return yield* Effect.fail(
            errors.BAD_REQUEST({
              message: `Bundle upload exceeds the ${maxBytes} byte ceiling (${totalBytes})`,
              data: { invalidFields: ["files"] },
            }),
          );
        }

        // Bounded pool: 736 sequential PUTs are minutes of pure round-trip
        // latency; 4-way concurrency cuts wall time ~4x with no extra memory
        // (all file bytes are already decoded in memory).
        const integrityEntries = yield* Effect.forEach(
          decoded,
          (file) =>
            Effect.gen(function* () {
              // Exit + squash: the storage layer's put is typed never-error
              // (Effect.promise rejections are defects) — this catches both
              // defects and typed failures so the cause reaches the client
              // as a CONNECTION_ERROR instead of a bare INTERNAL_SERVER_ERROR.
              const put = yield* Effect.exit(
                storage.put({
                  key: buildBundleKey(
                    input.account,
                    input.gateway,
                    input.workspace,
                    file.objectPath,
                  ),
                  bytes: file.bytes,
                  contentType: bundleContentType(file.name),
                  cacheControl: bundleCacheControl(file.name),
                }),
              );
              if (Exit.isFailure(put)) {
                const cause = Cause.squash(put.cause);
                return yield* Effect.fail(
                  errors.CONNECTION_ERROR({
                    message: `Bundle storage failed for ${file.objectPath}: ${
                      cause instanceof Error ? cause.message : String(cause)
                    }`,
                    data: {
                      errorCode: "STORAGE_PUT_FAILED",
                      suggestion:
                        "Check BOS_STORAGE_* (R2/MinIO) credentials and reachability on the API host",
                    },
                  }),
                );
              }
              return [file.objectPath, computeObjectIntegrity(file.bytes)] as const;
            }),
          { concurrency: 4 },
        );
        const integrity = Object.fromEntries(integrityEntries);

        return { stored: decoded.length, totalBytes, integrity, storage: storage.backend };
      }),
    };

    const templateRouter = (plugins as Record<string, { router?: unknown } | undefined>).template
      ?.router;
    if (templateRouter) {
      (router as Record<string, unknown>).things = templateRouter;
    }

    return router;
  },
});
