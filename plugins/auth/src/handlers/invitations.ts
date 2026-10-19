import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { mapDomainError } from "../services/domain-errors";
import { InvitationsService } from "../services/invitations";
import { createHeaders } from "../utils";

export function createInvitationHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    inviteMember: builder.inviteMember.use(requireAuth).effect(function* ({ input, context }) {
      const invitations = yield* InvitationsService;
      return yield* mapDomainError(
        invitations.inviteMember(createHeaders(context.reqHeaders), input),
      );
    }),

    getInvitation: builder.getInvitation.effect(function* ({ input, context }) {
      const invitations = yield* InvitationsService;
      return yield* mapDomainError(
        invitations.getInvitation(
          createHeaders(context.reqHeaders ?? {}),
          input.id,
          context.user?.id ?? null,
        ),
      );
    }),

    listInvitations: builder.listInvitations.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const invitations = yield* InvitationsService;
      return yield* mapDomainError(
        invitations.listInvitations(
          createHeaders(context.reqHeaders),
          context,
          input?.organizationId,
        ),
      );
    }),

    listUserInvitations: builder.listUserInvitations.use(requireAuth).effect(function* ({
      context,
    }) {
      const invitations = yield* InvitationsService;
      return yield* mapDomainError(
        invitations.listUserInvitations(createHeaders(context.reqHeaders), {
          userId: context.userId,
          emailUnverified: context.user?.emailVerified === false,
        }),
      );
    }),

    cancelInvitation: builder.cancelInvitation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const invitations = yield* InvitationsService;
      return yield* mapDomainError(
        invitations.cancelInvitation(createHeaders(context.reqHeaders), input.invitationId),
      );
    }),

    acceptInvitation: builder.acceptInvitation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const invitations = yield* InvitationsService;
      return yield* mapDomainError(
        invitations.acceptInvitation(createHeaders(context.reqHeaders), input.invitationId),
      );
    }),

    acceptNearInvitation: builder.acceptNearInvitation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const invitations = yield* InvitationsService;
      return yield* mapDomainError(
        invitations.acceptNearInvitation(createHeaders(context.reqHeaders), input.invitationId),
      );
    }),

    rejectNearInvitation: builder.rejectNearInvitation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const invitations = yield* InvitationsService;
      return yield* mapDomainError(
        invitations.rejectNearInvitation(createHeaders(context.reqHeaders), input.invitationId),
      );
    }),

    rejectInvitation: builder.rejectInvitation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const invitations = yield* InvitationsService;
      return yield* mapDomainError(
        invitations.rejectInvitation(createHeaders(context.reqHeaders), input.invitationId),
      );
    }),
  };
}
