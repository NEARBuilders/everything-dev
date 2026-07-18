import { createPlugin } from "every-plugin";
import { Effect, Layer } from "every-plugin/effect";
import { MemoryPublisher } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract, type ThingEventSchema } from "./contract";
import { DatabaseLive } from "./db/layer";
import { createAuthMiddleware } from "./lib/auth";
import { ContextSchema, runEffect } from "./lib/context";
import type { PluginsClient } from "./lib/plugins-types.gen";
import { RegistryLive, RegistryTag } from "./services/registry";
import {
  generateThingId,
  getThingProvider,
  toThingEvent,
  toThingOutput,
  unsupportedPluginError,
} from "./services/thing";
import { VotesLive, VotesTag } from "./services/votes";

type ThingEvent = z.infer<typeof ThingEventSchema>;

type ThingEvents = {
  thing: ThingEvent;
};

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({}),

  secrets: z.object({
    API_DATABASE_URL: z.string().refine(
      (val) => {
        if (process.env.NODE_ENV === "production" && val.startsWith("pglite:")) {
          return false;
        }
        return true;
      },
      {
        message:
          "API_DATABASE_URL must be a production database URL in production (pglite: is not supported)",
      },
    ),
  }),

  context: ContextSchema,

  contract,

  initialize: (config, plugins) =>
    Effect.gen(function* () {
      const database = DatabaseLive(config.secrets.API_DATABASE_URL);
      const registryLayer = RegistryLive.pipe(Layer.provide(database));

      const thingRegistry = yield* Effect.provide(RegistryTag, registryLayer);
      const thingVotes = yield* Effect.provide(VotesTag, VotesLive);
      const publisher = new MemoryPublisher<ThingEvents>({ resumeRetentionSeconds: 120 });

      const { auth, ...restPlugins } = plugins;
      yield* Effect.logInfo("[API] Services Initialized");
      yield* Effect.logInfo(`[API] Auth client available: ${Boolean(auth)}`);
      yield* Effect.logInfo(
        `[API] Plugins available: ${Object.keys(restPlugins).join(", ") || "none"}`,
      );

      return {
        auth,
        plugins: restPlugins,
        thingRegistry,
        thingVotes,
        publisher,
      };
    }),

  shutdown: () => Effect.logInfo("[API] Shutdown"),

  createRouter: (services, builder) => {
    const { requireAuth, requireAuthOrApiKey, requireAdmin } = createAuthMiddleware(builder);

    return {
      ping: builder.ping.handler(async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
      })),

      authHealth: builder.authHealth.use(requireAuth).handler(async () => ({
        status: "ok",
        emailConfigured: !!process.env.EMAIL_PROVIDER,
        smsConfigured: !!process.env.SMS_PROVIDER,
      })),

      createThing: builder.createThing
        .use(requireAuthOrApiKey)
        .handler(async ({ input, context }) => {
          const provider = getThingProvider(input.pluginId);
          if (!provider) {
            throw unsupportedPluginError(input.pluginId);
          }

          const thingId = generateThingId();
          const providerResult = await provider.create(
            services.plugins,
            { thingId, payload: input.payload },
            context,
          );
          const thingRecord = await runEffect(
            services.thingRegistry.createThing({ thingId, pluginId: input.pluginId }),
          );
          const thing = toThingOutput(thingRecord, providerResult);

          await services.publisher.publish(
            "thing",
            toThingEvent({
              thingId,
              pluginId: input.pluginId,
              type: providerResult.type,
              action: providerResult.action ?? "created",
            }),
          );

          return thing;
        }),

      getThing: builder.getThing.handler(async ({ input, context, errors }) => {
        const thingRecord = await runEffect(services.thingRegistry.getThing(input.thingId));
        if (!thingRecord) {
          throw errors.NOT_FOUND({
            message: "Thing not found",
            data: { resource: "thing", resourceId: input.thingId },
          });
        }

        const provider = getThingProvider(thingRecord.pluginId);
        if (!provider) {
          throw unsupportedPluginError(thingRecord.pluginId);
        }

        const providerResult = await provider.get(
          services.plugins,
          { thingId: input.thingId },
          context,
        );
        return toThingOutput(thingRecord, providerResult);
      }),

      upvoteThing: builder.upvoteThing
        .use(requireAuth)
        .handler(async ({ input, context, errors }) => {
          const thingRecord = await runEffect(services.thingRegistry.getThing(input.thingId));
          if (!thingRecord) {
            throw errors.NOT_FOUND({
              message: "Thing not found",
              data: { resource: "thing", resourceId: input.thingId },
            });
          }

          const provider = getThingProvider(thingRecord.pluginId);
          if (!provider) {
            throw unsupportedPluginError(thingRecord.pluginId);
          }

          const providerResult = await provider.get(
            services.plugins,
            { thingId: input.thingId },
            context,
          );
          const result = await runEffect(
            services.thingVotes.upvote({
              thingId: input.thingId,
              pluginId: thingRecord.pluginId,
              type: providerResult.type,
              userId: context.userId,
            }),
          );

          await runEffect(services.thingRegistry.touchThing(input.thingId));

          await services.publisher.publish(
            "thing",
            toThingEvent({
              thingId: input.thingId,
              pluginId: thingRecord.pluginId,
              type: providerResult.type,
              action: "upvoted",
              userId: context.userId,
              totalCount: result.totalCount,
            }),
          );

          return result;
        }),

      downvoteThing: builder.downvoteThing
        .use(requireAuth)
        .handler(async ({ input, context, errors }) => {
          const thingRecord = await runEffect(services.thingRegistry.getThing(input.thingId));
          if (!thingRecord) {
            throw errors.NOT_FOUND({
              message: "Thing not found",
              data: { resource: "thing", resourceId: input.thingId },
            });
          }

          const provider = getThingProvider(thingRecord.pluginId);
          if (!provider) {
            throw unsupportedPluginError(thingRecord.pluginId);
          }

          const providerResult = await provider.get(
            services.plugins,
            { thingId: input.thingId },
            context,
          );
          const result = await runEffect(
            services.thingVotes.downvote({
              thingId: input.thingId,
              pluginId: thingRecord.pluginId,
              type: providerResult.type,
              userId: context.userId,
            }),
          );

          await runEffect(services.thingRegistry.touchThing(input.thingId));

          await services.publisher.publish(
            "thing",
            toThingEvent({
              thingId: input.thingId,
              pluginId: thingRecord.pluginId,
              type: providerResult.type,
              action: "downvoted",
              userId: context.userId,
              totalCount: result.totalCount,
            }),
          );

          return result;
        }),

      getUpvoteCount: builder.getUpvoteCount.handler(async ({ input, errors }) => {
        const thingRecord = await runEffect(services.thingRegistry.getThing(input.thingId));
        if (!thingRecord) {
          throw errors.NOT_FOUND({
            message: "Thing not found",
            data: { resource: "thing", resourceId: input.thingId },
          });
        }

        return await runEffect(services.thingVotes.getUpvoteCount(input.thingId));
      }),

      getUserVote: builder.getUserVote
        .use(requireAuth)
        .handler(async ({ input, context, errors }) => {
          const thingRecord = await runEffect(services.thingRegistry.getThing(input.thingId));
          if (!thingRecord) {
            throw errors.NOT_FOUND({
              message: "Thing not found",
              data: { resource: "thing", resourceId: input.thingId },
            });
          }

          return await runEffect(services.thingVotes.getUserVote(input.thingId, context.userId));
        }),

      getUserVotes: builder.getUserVotes.use(requireAuth).handler(async ({ input, context }) => {
        return await runEffect(services.thingVotes.getUserVotes(input.thingIds, context.userId));
      }),

      getUpvoteCounts: builder.getUpvoteCounts.handler(async ({ input }) => {
        return await runEffect(services.thingVotes.getUpvoteCounts(input.thingIds));
      }),

      getUpvoteFeed: builder.getUpvoteFeed.handler(async ({ input }) => {
        return await runEffect(services.thingVotes.getUpvoteFeed(input.limit, input.cursor));
      }),

      deleteThing: builder.deleteThing
        .use(requireAdmin)
        .handler(async ({ input, context, errors }) => {
          const thingRecord = await runEffect(services.thingRegistry.getThing(input.thingId));
          if (!thingRecord) {
            throw errors.NOT_FOUND({
              message: "Thing not found",
              data: { resource: "thing", resourceId: input.thingId },
            });
          }

          const provider = getThingProvider(thingRecord.pluginId);
          if (provider?.delete) {
            await provider.delete(services.plugins, { thingId: input.thingId }, context);
          }

          await runEffect(services.thingRegistry.deleteThing(input.thingId));

          await services.publisher.publish(
            "thing",
            toThingEvent({
              thingId: input.thingId,
              pluginId: thingRecord.pluginId,
              type: "system",
              action: "deleted",
            }),
          );

          return { success: true as const };
        }),

      subscribeThings: builder.subscribeThings.handler(async function* ({
        input,
        signal,
        lastEventId,
      }) {
        const iterator = services.publisher.subscribe("thing", { signal, lastEventId });

        for await (const event of iterator) {
          if (input.thingId && event.thingId !== input.thingId) continue;
          if (input.pluginId && event.pluginId !== input.pluginId) continue;
          if (input.type && event.type !== input.type) continue;
          if (input.action && event.action !== input.action) continue;
          yield event;
        }
      }),
    };
  },
});
