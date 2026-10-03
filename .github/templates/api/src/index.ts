import { ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { ContextSchema } from "./lib/context";

export default createPlugin({
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
      return DatabaseLive(config.secrets.API_DATABASE_URL);
    }),

  createRouter: (builder) => {
    return {
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
            throw new ORPCError("BAD_REQUEST", {
              message: "test bad request error",
            });
          default:
            throw new Error("test internal server error");
        }
      }),
    };
  },
});
