import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { MembersService } from "../services/members";
import { createHeaders } from "../utils";

export function createMemberHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    exportMembers: builder.exportMembers.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const members = yield* MembersService;
      return yield* members.exportMembers(
        createHeaders(context.reqHeaders),
        context,
        input?.organizationId,
      );
    }),

    getActiveMember: builder.getActiveMember.use(requireAuth).effect(function* ({
      context,
      input,
    }) {
      const members = yield* MembersService;
      return yield* members.getActiveMember(
        createHeaders(context.reqHeaders),
        input?.organizationId,
      );
    }),

    getActiveMemberRole: builder.getActiveMemberRole.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const members = yield* MembersService;
      return yield* members.getActiveMemberRole(
        createHeaders(context.reqHeaders),
        input?.organizationId,
      );
    }),

    listMembers: builder.listMembers.use(requireAuth).effect(function* ({ input, context }) {
      const members = yield* MembersService;
      return yield* members.listMembers(createHeaders(context.reqHeaders), context, input);
    }),

    addMember: builder.addMember.use(requireAuth).effect(function* ({ input, context }) {
      const members = yield* MembersService;
      return yield* members.addMember(createHeaders(context.reqHeaders), context, input);
    }),

    removeMember: builder.removeMember.use(requireAuth).effect(function* ({ input, context }) {
      const members = yield* MembersService;
      return yield* members.removeMember(createHeaders(context.reqHeaders), input);
    }),

    updateMemberRole: builder.updateMemberRole.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const members = yield* MembersService;
      return yield* members.updateMemberRole(createHeaders(context.reqHeaders), context, input);
    }),
  };
}
