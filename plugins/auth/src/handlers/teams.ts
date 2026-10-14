import { mapDomainError } from "../services/domain-errors";
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
      return yield* mapDomainError(teams.setActiveTeam(createHeaders(context.reqHeaders), input.teamId));
    }),

    listUserTeams: builder.listUserTeams.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* mapDomainError(teams.listUserTeams(createHeaders(context.reqHeaders), input?.organizationId));
    }),

    createTeam: builder.createTeam.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* mapDomainError(teams.createTeam(createHeaders(context.reqHeaders), input));
    }),

    updateTeam: builder.updateTeam.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* mapDomainError(teams.updateTeam(createHeaders(context.reqHeaders), input));
    }),

    deleteTeam: builder.deleteTeam.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* mapDomainError(teams.deleteTeam(createHeaders(context.reqHeaders), context.userId, input));
    }),

    listTeams: builder.listTeams.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* mapDomainError(teams.listTeams(createHeaders(context.reqHeaders), input.organizationId));
    }),

    listTeamMembers: builder.listTeamMembers.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const teams = yield* TeamsService;
      return yield* mapDomainError(teams.listTeamMembers(context.userId, input.teamId));
    }),

    addTeamMember: builder.addTeamMember.use(requireAuth).effect(function* ({ input, context }) {
      const teams = yield* TeamsService;
      return yield* mapDomainError(teams.addTeamMember(createHeaders(context.reqHeaders), input));
    }),

    removeTeamMember: builder.removeTeamMember.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const teams = yield* TeamsService;
      return yield* mapDomainError(teams.removeTeamMember(createHeaders(context.reqHeaders), input));
    }),
  };
}
