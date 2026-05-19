import { BAD_REQUEST, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";
import { eventIterator, oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

export const VoteEventSchema = z.object({
  type: z.enum(["upvote", "downvote"]),
  thingId: z.string(),
  userId: z.string(),
  timestamp: z.string(),
  totalCount: z.number().int().nonnegative(),
});

export const contract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(
    z.object({
      status: z.literal("ok"),
      timestamp: z.iso.datetime(),
    }),
  ),

  authHealth: oc
    .route({ method: "GET", path: "/auth/health" })
    .output(
      z.object({
        status: z.string(),
        emailConfigured: z.boolean(),
        smsConfigured: z.boolean(),
      }),
    )
    .errors({ UNAUTHORIZED }),

  upvoteThing: oc
    .route({ method: "POST", path: "/upvotes" })
    .input(z.object({ thingId: z.string() }))
    .output(
      z.object({
        thingId: z.string(),
        userId: z.string(),
        totalCount: z.number().int().nonnegative(),
      }),
    )
    .errors({ UNAUTHORIZED, BAD_REQUEST }),

  downvoteThing: oc
    .route({ method: "DELETE", path: "/upvotes/{thingId}" })
    .input(z.object({ thingId: z.string() }))
    .output(
      z.object({
        thingId: z.string(),
        totalCount: z.number().int().nonnegative(),
      }),
    )
    .errors({ UNAUTHORIZED, NOT_FOUND }),

  getUpvoteCount: oc
    .route({ method: "GET", path: "/upvotes/{thingId}/count" })
    .input(z.object({ thingId: z.string() }))
    .output(
      z.object({
        thingId: z.string(),
        totalCount: z.number().int().nonnegative(),
      }),
    ),

  getUserVote: oc
    .route({ method: "GET", path: "/upvotes/{thingId}/me" })
    .input(z.object({ thingId: z.string() }))
    .output(
      z.object({
        thingId: z.string(),
        hasUpvote: z.boolean(),
      }),
    )
    .errors({ UNAUTHORIZED }),

  getUpvoteFeed: oc
    .route({ method: "GET", path: "/upvotes/feed" })
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      }),
    )
    .output(
      z.object({
        data: z.array(
          z.object({
            id: z.string(),
            thingId: z.string(),
            userId: z.string(),
            createdAt: z.iso.datetime(),
          }),
        ),
        meta: z.object({
          total: z.number().int().nonnegative(),
          hasMore: z.boolean(),
          nextCursor: z.string().nullable(),
        }),
      }),
    ),

  subscribeUpvotes: oc
    .route({ method: "GET", path: "/upvotes/stream" })
    .output(eventIterator(VoteEventSchema)),
});

export type ContractType = typeof contract;
