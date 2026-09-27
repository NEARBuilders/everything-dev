import { MemoryPublisher } from "@orpc/publisher/memory";
import { getEventMeta, ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { ContextSchema } from "./lib/context";
import type { PluginsClient } from "./lib/plugins-client.gen";
import { TemplateService } from "./service";
import { ThingsService } from "./services/things";

type TemplateEvents = {
  "background-updates": {
    id: string;
    index: number;
    timestamp: number;
  };
  "thing-updates": {
    thingId: string;
    type: string;
    action: string;
    timestamp: string;
  };
};

class TemplateApiClient extends Context.Service<TemplateApiClient, TemplateService>()(
  "template/ApiClient",
) {}

class TemplatePublisher extends Context.Service<
  TemplatePublisher,
  MemoryPublisher<TemplateEvents>
>()("template/Publisher") {}

/**
 * Template Plugin - Demonstrates core plugin patterns.
 *
 * Shows how to:
 * - Compose service Layers in `initialize` (the runtime builds them in the
 *   plugin's lifecycle scope)
 * - Access services in `.effect()` handlers via `yield* Tag`
 * - Access services in streaming (async generator) handlers via
 *   `Context.get(context["effect/context"], Tag)`
 * - Merge a sibling plugin's router directly (`things: plugins.template.router`)
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

  initialize: (config) =>
    Effect.gen(function* () {
      const service = new TemplateService(
        config.variables.baseUrl,
        config.secrets.TEMPLATE_API_KEY,
        config.variables.timeout,
      );

      yield* service.ping();

      const publisher = new MemoryPublisher<TemplateEvents>({
        resume: { enabled: true, seconds: 60 * 2 },
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
                Effect.catch((error) =>
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

      return Layer.mergeAll(
        Layer.succeed(TemplateApiClient, service),
        ThingsService.Live.pipe(Layer.provide(DatabaseLive(config.secrets.TEMPLATE_DATABASE_URL))),
        Layer.succeed(TemplatePublisher, publisher),
      );
    }),

  createRouter: (builder) => {
    return {
      getById: builder.getById.effect(function* ({ input, context, errors }) {
        if (!context.userId) {
          return yield* Effect.fail(errors.UNAUTHORIZED({ message: "User ID required" }));
        }
        const service = yield* TemplateApiClient;
        const item = yield* service.getById(input.id).pipe(
          Effect.catch((error) =>
            Effect.fail(
              error.message.includes("Item not found")
                ? errors.NOT_FOUND({
                    message: `Failed to fetch item: ${error.message}`,
                  })
                : new ORPCError("INTERNAL_SERVER_ERROR", {
                    message: error.message,
                  }),
            ),
          ),
        );
        return { item, userId: context.userId };
      }),

      search: builder.search.handler(async function* ({ input, context }) {
        const service = Context.get(context["effect/context"], TemplateApiClient);
        const generator = service.search(input.query, input.limit);

        for await (const result of generator) {
          yield result;
        }
      }),

      ping: builder.ping.effect(function* () {
        const service = yield* TemplateApiClient;
        return yield* service.ping();
      }),

      listenBackground: builder.listenBackground.handler(async function* ({
        input,
        context,
        signal,
        lastEventId,
      }) {
        let count = 0;
        const maxResults = input.maxResults;
        const publisher = Context.get(context["effect/context"], TemplatePublisher);
        const iterator = publisher.subscribe("background-updates", {
          signal,
          lastEventId,
        });

        for await (const event of iterator) {
          if (maxResults && count >= maxResults) break;

          const meta = getEventMeta(event);
          if (meta?.id) {
            yield event;
            count++;
          }
        }
      }),

      enqueueBackground: builder.enqueueBackground.effect(function* ({ input }) {
        const publisher = yield* TemplatePublisher;
        const event = {
          id: input.id || `manual-${Date.now()}`,
          index: -1,
          timestamp: Date.now(),
        };

        yield* Effect.promise(() => publisher.publish("background-updates", event));
        return { ok: true };
      }),

      createThing: builder.createThing.effect(function* ({ input, context, errors }) {
        if (!context.userId) return yield* Effect.fail(errors.UNAUTHORIZED());
        const things = yield* ThingsService;
        const thing = yield* things.createThing(input.thingId, input.payload);
        const publisher = yield* TemplatePublisher;
        yield* Effect.promise(() =>
          publisher.publish("thing-updates", {
            thingId: thing.thingId,
            type: thing.type,
            action: thing.action,
            timestamp: new Date().toISOString(),
          }),
        );
        return thing;
      }),

      getThing: builder.getThing.effect(function* ({ input }) {
        const things = yield* ThingsService;
        return yield* things.getThing(input.thingId);
      }),

      listThings: builder.listThings.effect(function* ({ input }) {
        const things = yield* ThingsService;
        return yield* things.listThings(input);
      }),

      subscribeThings: builder.subscribeThings.handler(async function* ({
        input,
        context,
        signal,
        lastEventId,
      }) {
        const publisher = Context.get(context["effect/context"], TemplatePublisher);
        const iterator = publisher.subscribe("thing-updates", {
          signal,
          lastEventId,
        });

        for await (const event of iterator) {
          if (input.thingId && event.thingId !== input.thingId) continue;
          if (input.type && event.type !== input.type) continue;
          if (input.action && event.action !== input.action) continue;
          yield event;
        }
      }),

      deleteThing: builder.deleteThing.effect(function* ({ input, context, errors }) {
        if (!context.userId) return yield* Effect.fail(errors.UNAUTHORIZED());
        const things = yield* ThingsService;
        const thing = yield* things.getThing(input.thingId);
        const result = yield* things.deleteThing(input.thingId);
        const publisher = yield* TemplatePublisher;
        yield* Effect.promise(() =>
          publisher.publish("thing-updates", {
            thingId: thing.thingId,
            type: thing.type,
            action: `${thing.type}.deleted`,
            timestamp: new Date().toISOString(),
          }),
        );
        return result;
      }),

      testError: builder.testError.effect(function* ({ input, errors }) {
        switch (input.kind) {
          case "unauthorized":
            return yield* Effect.fail(errors.UNAUTHORIZED({ message: "test unauthorized error" }));
          case "forbidden":
            return yield* Effect.fail(errors.FORBIDDEN({ message: "test forbidden error" }));
          case "not_found":
            return yield* Effect.fail(errors.NOT_FOUND({ message: "test not found error" }));
          case "conflict":
            return yield* Effect.fail(errors.CONFLICT({ message: "test conflict error" }));
          case "bad_request":
            return yield* Effect.fail(errors.BAD_REQUEST({ message: "test bad request error" }));
          default:
            return yield* Effect.fail(
              new ORPCError("INTERNAL_SERVER_ERROR", {
                message: "test internal server error",
              }),
            );
        }
      }),
    };
  },
});
