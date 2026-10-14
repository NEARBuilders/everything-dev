import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { TeamsService } from "../services/teams";
import { createHeaders } from "../utils";

export function createTeamHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    setActiveTeam: builder.setActiveTeam.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* teams.setActiveTeam(createHeaders(context.reqHeaders), input.teamId);
    }),

    listUserTeams: builder.listUserTeams.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* teams.listUserTeams(createHeaders(context.reqHeaders), input?.organizationId);
    }),

    createTeam: builder.createTeam.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* teams.createTeam(createHeaders(context.reqHeaders), input);
    }),

    updateTeam: builder.updateTeam.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* teams.updateTeam(createHeaders(context.reqHeaders), input);
    }),

    deleteTeam: builder.deleteTeam.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* teams.deleteTeam(createHeaders(context.reqHeaders), context.userId, input);
    }),

    listTeams: builder.listTeams.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* teams.listTeams(createHeaders(context.reqHeaders), input.organizationId);
    }),

    listTeamMembers: builder.listTeamMembers.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const teams = yield* TeamsService;
      return yield* teams.listTeamMembers(
        createHeaders(context.reqHeaders),
        context.userId,
        input.teamId,
      );
    }),

    addTeamMember: builder.addTeamMember.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* teams.addTeamMember(createHeaders(context.reqHeaders), input);
    }),

    removeTeamMember: builder.removeTeamMember.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const teams = yield* TeamsService;
      return yield* teams.removeTeamMember(createHeaders(context.reqHeaders), input);
    }),
  };
}
