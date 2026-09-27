import { ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { ContextSchema } from "./lib/context";
import { VoteService, VoteServiceLive } from "./services/votes";

export default createPlugin({
  variables: z.object({}),

  secrets: z.object({
    VOTES_DATABASE_URL: z.string().default("pglite:.bos/votes/:memory:"),
  }),

  context: ContextSchema,

  contract,

  initialize: (config) =>
    Effect.succeed(
      VoteServiceLive.pipe(Layer.provide(DatabaseLive(config.secrets.VOTES_DATABASE_URL))),
    ),

  createRouter: (builder) => {
    const requireAuth = builder.middleware(async ({ context, next }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
      }
      return next({ context });
    });

    return {
      upvote: builder.upvote.use(requireAuth).handler(async ({ input, context }) => {
        const voteService = Context.get(context["effect/context"], VoteService);
        return await voteService.upvote(input.entityId, context.userId!);
      }),
      downvote: builder.downvote.use(requireAuth).handler(async ({ input, context }) => {
        const voteService = Context.get(context["effect/context"], VoteService);
        return await voteService.downvote(input.entityId, context.userId!);
      }),
      getUpvoteCount: builder.getUpvoteCount.handler(async ({ input, context }) => {
        const voteService = Context.get(context["effect/context"], VoteService);
        return await voteService.getUpvoteCount(input.entityId);
      }),
      getUserVote: builder.getUserVote.use(requireAuth).handler(async ({ input, context }) => {
        const voteService = Context.get(context["effect/context"], VoteService);
        return await voteService.getUserVote(input.entityId, context.userId!);
      }),
      getUserVotes: builder.getUserVotes.use(requireAuth).handler(async ({ input, context }) => {
        const voteService = Context.get(context["effect/context"], VoteService);
        return await voteService.getUserVotes(input.entityIds, context.userId!);
      }),
      getUpvoteCounts: builder.getUpvoteCounts.handler(async ({ input, context }) => {
        const voteService = Context.get(context["effect/context"], VoteService);
        return await voteService.getUpvoteCounts(input.entityIds);
      }),
      getUpvoteFeed: builder.getUpvoteFeed.handler(async ({ input, context }) => {
        const voteService = Context.get(context["effect/context"], VoteService);
        return await voteService.getUpvoteFeed(input.limit, input.cursor);
      }),
      subscribe: builder.subscribe.handler(async function* ({ context, signal, lastEventId }) {
        const voteService = Context.get(context["effect/context"], VoteService);
        const iterator = voteService.publisher.subscribe("vote", { signal, lastEventId });
        for await (const event of iterator) {
          yield event;
        }
      }),
    };
  },
});
