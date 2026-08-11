import { createPlugin } from "every-plugin";
import { Effect, Layer } from "every-plugin/effect";
import { getEventMeta, MemoryPublisher, ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { ContextSchema, runEffect } from "./lib/context";
import type { PluginsClient } from "./plugins-client.gen";
import { TemplateService } from "./service";
import { ThingsService } from "./services/things";

type BackgroundEvents = {
  "background-updates": {
    id: string;
    index: number;
    timestamp: number;
  };
};

/**
 * Template Plugin - Demonstrates core plugin patterns.
 *
 * Shows how to:
 * - Initialize a simple service
 * - Build scoped resources (DB pools, etc.) via tools.buildService when needed
 * - Implement single fetch and streaming procedures
 * - Handle errors with CommonPluginErrors
 *
 * Context fields available from the host:
 *   userId, user ({ id, role, email, name }),
 *   apiKey ({ id, name, permissions }),
 *   organization ({ activeOrganizationId, organization ({ id, name, slug, logo, metadata }),
 *     member ({ id, role }), isPersonal, hasOrganization }),
 *   near ({ primaryAccountId, linkedAccounts[], hasNearAccount }),
 *   reqHeaders, getRawBody
 *
 * Access organization membership via context.organization?.activeOrganizationId
 * and context.organization?.member?.role.
 * Access NEAR account via context.near?.primaryAccountId.
 */
export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({
    baseUrl: z.url().default("https://api.example.com"),
    timeout: z.number().min(1000).max(60000).default(10000),
    backgroundEnabled: z.boolean().default(false),
    backgroundIntervalMs: z.number().min(50).max(60000).default(30000),
  }),

  secrets: z.object({
    TEMPLATE_API_KEY: z.string().min(1, "TEMPLATE_API_KEY is required").default("template-dev-key"),
    TEMPLATE_DATABASE_URL: z
      .string()
      .default("pglite:.bos/_template/:memory:")
      .describe("Database connection string. Use pglite: for local, postgres:// for production."),
  }),

  context: ContextSchema,

  contract,

  initialize: (config, _plugins, tools) =>
    Effect.gen(function* () {
      const service = new TemplateService(
        config.variables.baseUrl,
        config.secrets.TEMPLATE_API_KEY,
        config.variables.timeout,
      );

      yield* service.ping();

      // Scoped DB-backed service (pool lifecycle is bound to the plugin scope).
      const thingsService = yield* tools.buildService(
        ThingsService,
        ThingsService.Live.pipe(Layer.provide(DatabaseLive(config.secrets.TEMPLATE_DATABASE_URL))),
      );

      const publisher = new MemoryPublisher<BackgroundEvents>({
        resumeRetentionSeconds: 60 * 2,
      });

      if (config.variables.backgroundEnabled) {
        yield* Effect.forkScoped(
          Effect.gen(function* () {
            let i = 0;
            while (true) {
              i++;
              const event = {
                id: `bg-${i}`,
                index: i,
                timestamp: Date.now(),
              };

              yield* Effect.tryPromise(() => publisher.publish("background-updates", event)).pipe(
                Effect.catchAll((error) =>
                  Effect.logWarning(`[TemplatePlugin] Publish failed for event ${i}:`, error).pipe(
                    Effect.andThen(Effect.void),
                  ),
                ),
              );

              yield* Effect.sleep(`${config.variables.backgroundIntervalMs} millis`);
            }
          }),
        );
      }

      return { service, thingsService, publisher };
    }),

  shutdown: () => Effect.void,

  createRouter: (context, builder) => {
    const { service, thingsService, publisher } = context;

    return {
      getById: builder.getById.handler(async ({ input, context }) => {
        if (!context.userId) {
          throw new ORPCError("UNAUTHORIZED", { message: "User ID required" });
        }
        try {
          const item = await Effect.runPromise(service.getById(input.id));
          return { item, userId: context.userId };
        } catch (error) {
          if (error instanceof Error && error.message.includes("Item not found")) {
            throw new ORPCError("NOT_FOUND", { message: "Failed to fetch item: Item not found" });
          }
          throw error;
        }
      }),

      search: builder.search.handler(async function* ({ input }) {
        const generator = await Effect.runPromise(service.search(input.query, input.limit));

        for await (const result of generator) {
          yield result;
        }
      }),

      ping: builder.ping.handler(async () => {
        return await Effect.runPromise(service.ping());
      }),

      listenBackground: builder.listenBackground.handler(async function* ({
        input,
        signal,
        lastEventId,
      }) {
        let count = 0;
        const maxResults = input.maxResults;
        const iterator = publisher.subscribe("background-updates", { signal, lastEventId });

        for await (const event of iterator) {
          if (maxResults && count >= maxResults) break;

          const meta = getEventMeta(event);
          if (meta?.id) {
            yield event;
            count++;
          }
        }
      }),

      enqueueBackground: builder.enqueueBackground.handler(async ({ input }) => {
        const event = {
          id: input.id || `manual-${Date.now()}`,
          index: -1,
          timestamp: Date.now(),
        };

        await publisher.publish("background-updates", event);
        return { ok: true };
      }),

      createThing: builder.createThing.handler(async ({ input }) => {
        return await runEffect(thingsService.createThing(input.thingId, input.payload));
      }),

      getThing: builder.getThing.handler(async ({ input }) => {
        return await runEffect(thingsService.getThing(input.thingId));
      }),

      listThings: builder.listThings.handler(async ({ input }) => {
        return await runEffect(thingsService.listThings(input));
      }),

      deleteThing: builder.deleteThing.handler(async ({ input }) => {
        return await runEffect(thingsService.deleteThing(input.thingId));
      }),

      testError: builder.testError.handler(async ({ input }) => {
        switch (input.kind) {
          case "unauthorized":
            throw new ORPCError("UNAUTHORIZED", { message: "test unauthorized error" });
          case "forbidden":
            throw new ORPCError("FORBIDDEN", { message: "test forbidden error" });
          case "not_found":
            throw new ORPCError("NOT_FOUND", { message: "test not found error" });
          case "conflict":
            throw new ORPCError("CONFLICT", { message: "test conflict error" });
          case "bad_request":
            throw new ORPCError("BAD_REQUEST", { message: "test bad request error" });
          default:
            throw new Error("test internal server error");
        }
      }),
    };
  },
});
