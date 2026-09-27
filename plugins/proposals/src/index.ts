import { MemoryPublisher } from "@orpc/publisher/memory";
import { ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract, type ProposalEventSchema } from "./contract";
import { DatabaseLive } from "./db/layer";
import type { AuthPluginContext as AuthContext } from "./lib/auth-types.gen";
import { ProposalService, ProposalServiceLive } from "./services/proposals";

type ProposalEvent = z.infer<typeof ProposalEventSchema>;

type ProposalEvents = {
  proposal: ProposalEvent;
};

type ProposalContext = AuthContext & {
  allowPrivateSubmission?: boolean;
  resubmissionPolicy?: "rejected-only" | "rejected-or-removed";
};

const ProposalContextSchema = z.custom<ProposalContext>();

class ProposalPublisher extends Context.Service<
  ProposalPublisher,
  MemoryPublisher<ProposalEvents>
>()("proposals/Publisher") {}

class ProposalPluginConfig extends Context.Service<
  ProposalPluginConfig,
  { privatePluginIds: Set<string> }
>()("proposals/PluginConfig") {}

export default createPlugin({
  variables: z.object({
    privatePluginIds: z.array(z.string().min(1).max(100)).default([]),
  }),

  secrets: z.object({
    PROPOSALS_DATABASE_URL: z.string().default("pglite:.bos/proposals/:memory:"),
  }),

  context: ProposalContextSchema,

  contract,

  initialize: (config) =>
    Effect.sync(() => {
      const Database = DatabaseLive(config.secrets.PROPOSALS_DATABASE_URL);
      const publisher = new MemoryPublisher<ProposalEvents>({
        resume: { enabled: true, seconds: 120 },
      });

      console.log("[Proposals] Services Initialized");
      return Layer.mergeAll(
        ProposalServiceLive.pipe(Layer.provide(Database)),
        Layer.succeed(ProposalPublisher, publisher),
        Layer.succeed(ProposalPluginConfig, {
          privatePluginIds: new Set(config.variables.privatePluginIds),
        }),
      );
    }),

  createRouter: (builder) => {
    const requireAuth = builder.middleware(async ({ context, next }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
        });
      }
      return next({ context });
    });

    const requireAdmin = builder.middleware(async ({ context, next }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
        });
      }
      if (context.user.role !== "admin") {
        throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
      }
      return next({ context });
    });

    const requireAuthOrApiKey = builder.middleware(async ({ context, next }) => {
      if (!context.user && !context.userId && !context.apiKey) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { hint: "Sign in or provide an API key" },
        });
      }
      return next({ context });
    });

    const viewerId = (context: ProposalContext) =>
      context.near?.primaryAccountId ?? context.userId ?? context.apiKey?.id;

    const proposalScope = (privatePluginIds: Set<string>, context: ProposalContext) => ({
      privatePluginIds: Array.from(privatePluginIds),
      viewerId: viewerId(context),
      isAdmin: context.user?.role === "admin",
    });

    const canReadProposal = (context: ProposalContext, pluginId: string, entityId: string) =>
      Effect.gen(function* () {
        const { privatePluginIds } = yield* ProposalPluginConfig;
        if (!privatePluginIds.has(pluginId) || context.user?.role === "admin") return true;
        const proposal = yield* ProposalService;
        const scoped = yield* proposal.getProposals({
          pluginId,
          entityId,
          limit: 1,
          ...proposalScope(privatePluginIds, context),
        });
        return scoped.data.length > 0;
      });

    const publishProposalEvent = (action: string, proposal: any) =>
      Effect.gen(function* () {
        const publisher = yield* ProposalPublisher;
        yield* Effect.promise(() =>
          publisher.publish("proposal", {
            action,
            pluginId: proposal.pluginId,
            entityId: proposal.entityId,
            reviewStatus: proposal.reviewStatus,
            applyStatus: proposal.applyStatus,
            removeStatus: proposal.removeStatus,
            submissionCount: proposal.submissionCount,
            timestamp: new Date().toISOString(),
          }),
        );
      });

    return {
      propose: builder.propose.use(requireAuthOrApiKey).effect(function* ({ input, context }) {
        const { privatePluginIds } = yield* ProposalPluginConfig;
        if (privatePluginIds.has(input.pluginId) && !context.allowPrivateSubmission) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "Use the plugin's dedicated proposal endpoint",
            }),
          );
        }
        const actorId =
          context.near?.primaryAccountId ?? context.userId ?? context.apiKey?.id ?? "unknown";
        const proposal = yield* ProposalService;
        const result = yield* proposal.propose({
          ...input,
          actorId,
          actor: context.user ?? undefined,
          resubmissionPolicy: context.resubmissionPolicy,
        });
        yield* publishProposalEvent("proposed", result);
        return { data: result };
      }),

      approve: builder.approve.use(requireAdmin).effect(function* ({ input, context }) {
        const proposal = yield* ProposalService;
        const result = yield* proposal.approve({
          ...input,
          actorId: context.userId!,
          actor: context.user ?? undefined,
        });
        yield* publishProposalEvent("approved", result);
        return { data: result };
      }),

      reject: builder.reject.use(requireAdmin).effect(function* ({ input, context }) {
        const proposal = yield* ProposalService;
        const result = yield* proposal.reject({
          ...input,
          actorId: context.userId!,
          actor: context.user ?? undefined,
        });
        yield* publishProposalEvent("rejected", result);
        return { data: result };
      }),

      reopen: builder.reopen.use(requireAdmin).effect(function* ({ input, context }) {
        const proposal = yield* ProposalService;
        const result = yield* proposal.reopen({
          ...input,
          actorId: context.userId!,
          actor: context.user ?? undefined,
        });
        yield* publishProposalEvent("reopened", result);
        return { data: result };
      }),

      remove: builder.remove.use(requireAdmin).effect(function* ({ input, context }) {
        const proposal = yield* ProposalService;
        const result = yield* proposal.remove({
          ...input,
          actorId: context.userId!,
          actor: context.user ?? undefined,
        });
        yield* publishProposalEvent("removed", result);
        return { data: result };
      }),

      markApplied: builder.markApplied.use(requireAdmin).effect(function* ({ input }) {
        const proposal = yield* ProposalService;
        const result = yield* proposal.markApplied(input);
        yield* publishProposalEvent("applied", result);
        return { data: result };
      }),

      markApplyFailed: builder.markApplyFailed.use(requireAdmin).effect(function* ({ input }) {
        const proposal = yield* ProposalService;
        const result = yield* proposal.markApplyFailed(input);
        yield* publishProposalEvent("apply_failed", result);
        return { data: result };
      }),

      markRemoved: builder.markRemoved.use(requireAdmin).effect(function* ({ input }) {
        const proposal = yield* ProposalService;
        const result = yield* proposal.markRemoved(input);
        yield* publishProposalEvent("removed", result);
        return { data: result };
      }),

      markRemoveFailed: builder.markRemoveFailed.use(requireAdmin).effect(function* ({ input }) {
        const proposal = yield* ProposalService;
        const result = yield* proposal.markRemoveFailed(input);
        yield* publishProposalEvent("remove_failed", result);
        return { data: result };
      }),

      getProposals: builder.getProposals.effect(function* ({ input, context }) {
        const { privatePluginIds } = yield* ProposalPluginConfig;
        const proposal = yield* ProposalService;
        return yield* proposal.getProposals({
          ...input,
          ...proposalScope(privatePluginIds, context),
        });
      }),

      getProposalCount: builder.getProposalCount.effect(function* ({ input, context }) {
        if (!(yield* canReadProposal(context, input.pluginId, input.entityId))) {
          return { ...input, totalCount: 0 };
        }
        const proposal = yield* ProposalService;
        return yield* proposal.getProposalCount(input);
      }),

      getAuditLog: builder.getAuditLog.effect(function* ({ input, context }) {
        if (!(yield* canReadProposal(context, input.pluginId, input.entityId))) {
          return {
            data: [],
            meta: { total: 0, hasMore: false, nextCursor: null },
          };
        }
        const proposal = yield* ProposalService;
        return yield* proposal.getAuditLog(input);
      }),

      getSubmissions: builder.getSubmissions.use(requireAdmin).effect(function* ({ input }) {
        const proposal = yield* ProposalService;
        return yield* proposal.getSubmissions(input);
      }),

      getMySubmission: builder.getMySubmission.use(requireAuth).effect(function* ({
        input,
        context,
      }) {
        const nearAccounts = [
          context.near?.primaryAccountId,
          ...(context.near?.linkedAccounts ?? []).map(({ accountId }) => accountId),
        ];
        const submittedBy = Array.from(
          new Set(
            [
              context.userId,
              ...nearAccounts,
              ...nearAccounts.map((accountId) => accountId?.toLowerCase()),
            ].filter((value): value is string => Boolean(value)),
          ),
        );
        const proposal = yield* ProposalService;
        return yield* proposal.getMySubmission({
          ...input,
          submittedBy,
        });
      }),

      getReviewHistory: builder.getReviewHistory.use(requireAdmin).effect(function* ({ input }) {
        const proposal = yield* ProposalService;
        return yield* proposal.getReviewHistory(input);
      }),

      subscribe: builder.subscribe.handler(async function* ({
        input,
        context,
        signal,
        lastEventId,
      }) {
        const publisher = Context.get(context["effect/context"], ProposalPublisher);
        const iterator = publisher.subscribe("proposal", {
          signal,
          lastEventId,
        });
        for await (const event of iterator) {
          if (input.pluginId && event.pluginId !== input.pluginId) continue;
          if (input.entityId && event.entityId !== input.entityId) continue;
          if (
            !(await Effect.runPromise(
              canReadProposal(context, event.pluginId, event.entityId).pipe(
                Effect.provide(context["effect/context"]),
              ),
            ))
          ) {
            continue;
          }
          yield event;
        }
      }),
    };
  },
});
