import { and, count, desc, eq } from "drizzle-orm";
import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { MemoryPublisher } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract, type VoteEventSchema } from "./contract";
import { loadMigrations } from "./db/load-migrations";
import { migrate } from "./db/migrator";
import { upvotes } from "./db/schema";
import { createAuthGuards } from "./lib/auth";
import type { PluginsClient } from "./lib/plugins-types.gen";

type VoteEventDetail = z.infer<typeof VoteEventSchema>;

type VoteEvents = {
  vote: VoteEventDetail;
};

function generateId(): string {
  return `uv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function createUpvoteService(db: any, publisher: MemoryPublisher<VoteEvents>) {
  return {
    async upvoteThing(thingId: string, userId: string) {
      try {
        await db.insert(upvotes).values({
          id: generateId(),
          thingId,
          userId,
        });
      } catch {
        // unique constraint violation — already upvoted
      }

      const [result] = await db
        .select({ count: count() })
        .from(upvotes)
        .where(eq(upvotes.thingId, thingId));

      const totalCount = result?.count ?? 0;

      await publisher.publish("vote", {
        type: "upvote",
        thingId,
        userId,
        timestamp: new Date().toISOString(),
        totalCount,
      });

      return { thingId, userId, totalCount };
    },

    async downvoteThing(thingId: string, userId: string) {
      await db.delete(upvotes).where(and(eq(upvotes.thingId, thingId), eq(upvotes.userId, userId)));

      const [result] = await db
        .select({ count: count() })
        .from(upvotes)
        .where(eq(upvotes.thingId, thingId));

      const totalCount = result?.count ?? 0;

      await publisher.publish("vote", {
        type: "downvote",
        thingId,
        userId,
        timestamp: new Date().toISOString(),
        totalCount,
      });

      return { thingId, totalCount };
    },

    async getUpvoteCount(thingId: string) {
      const [result] = await db
        .select({ count: count() })
        .from(upvotes)
        .where(eq(upvotes.thingId, thingId));

      return { thingId, totalCount: result?.count ?? 0 };
    },

    async getUserVote(thingId: string, userId: string) {
      const [result] = await db
        .select({ count: count() })
        .from(upvotes)
        .where(and(eq(upvotes.thingId, thingId), eq(upvotes.userId, userId)));
      return { thingId, hasUpvote: (result?.count ?? 0) > 0 };
    },

    async getUpvoteFeed(limit = 50, _cursor?: string) {
      const pageLimit = Math.min(limit, 100);
      const records = await db
        .select()
        .from(upvotes)
        .orderBy(desc(upvotes.createdAt))
        .limit(pageLimit + 1);

      const hasMore = records.length > pageLimit;
      const data = records.slice(0, pageLimit).map((r: any) => ({
        id: r.id,
        thingId: r.thingId,
        userId: r.userId,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      }));

      return {
        data,
        meta: {
          total: data.length,
          hasMore,
          nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null,
        },
      };
    },
  };
}

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({}),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("pglite:.bos/api/:memory:"),
  }),

  context: z.object({
    userId: z.string().optional(),
    user: z
      .object({
        id: z.string(),
        role: z.string().optional(),
        email: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    organizationId: z.string().optional(),
    reqHeaders: z.custom<Headers>().optional(),
    getRawBody: z.custom<() => Promise<string>>().optional(),
  }),

  contract,

  initialize: (config, plugins) =>
    Effect.promise(async () => {
      const { createDatabaseDriver } = await import("./db/index");
      const driver = await createDatabaseDriver(config.secrets.API_DATABASE_URL);

      const migrations = await loadMigrations();
      await migrate(driver.db, migrations);
      console.log("[API] Migrations applied");

      const { auth, ...restPlugins } = plugins;
      console.log("[API] Services Initialized");
      console.log("[API] Auth client available:", Boolean(auth));
      console.log("[API] Plugins available:", Object.keys(restPlugins).join(", ") || "none");

      const publisher = new MemoryPublisher<VoteEvents>({
        resumeRetentionSeconds: 120,
      });
      const upvoteService = createUpvoteService(driver.db, publisher);

      return { auth, plugins: restPlugins, db: driver.db, upvoteService, publisher, driver };
    }),

  shutdown: (services) =>
    Effect.promise(async () => {
      console.log("[API] Shutdown");
      await (services as any).driver?.close?.();
    }),

  createRouter: (services, builder) => {
    const { requireAuth } = createAuthGuards(builder);
    const { publisher } = services;

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

      upvoteThing: builder.upvoteThing.use(requireAuth).handler(async ({ input, context }) => {
        return await services.upvoteService.upvoteThing(input.thingId, context.userId!);
      }),

      downvoteThing: builder.downvoteThing.use(requireAuth).handler(async ({ input, context }) => {
        return await services.upvoteService.downvoteThing(input.thingId, context.userId!);
      }),

      getUpvoteCount: builder.getUpvoteCount.handler(async ({ input }) => {
        return await services.upvoteService.getUpvoteCount(input.thingId);
      }),

      getUserVote: builder.getUserVote.use(requireAuth).handler(async ({ input, context }) => {
        return await services.upvoteService.getUserVote(input.thingId, context.userId!);
      }),

      getUpvoteFeed: builder.getUpvoteFeed.handler(async ({ input }) => {
        return await services.upvoteService.getUpvoteFeed(input.limit, input.cursor);
      }),

      subscribeUpvotes: builder.subscribeUpvotes.handler(async function* ({ signal, lastEventId }) {
        const iterator = publisher.subscribe("vote", { signal, lastEventId });
        for await (const event of iterator) {
          yield event;
        }
      }),
    };
  },
});
