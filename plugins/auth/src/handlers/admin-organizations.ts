import type { Implementer } from "@orpc/server";
import { createAuthMiddleware } from "everything-dev/api";
import type { ContractType } from "../contract";
import type {
  AuthHandlerAuthedContext,
  AuthHandlerContext,
  RequireAuthMiddleware,
} from "../middleware";
import { AdminOrganizationsService } from "../services/admin-organizations";
import { mapDomainError } from "../services/domain-errors";

export function createAdminOrganizationHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  const { requireAdmin } = createAuthMiddleware<AuthHandlerAuthedContext>(builder);
  return {
    adminListOrganizations: builder.adminListOrganizations
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.listOrganizations(input));
      }),

    adminGetOrganizationFull: builder.adminGetOrganizationFull
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.getOrganizationFull(input.organizationId));
      }),

    adminCreateOrganizationForUser: builder.adminCreateOrganizationForUser
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.createOrganizationForUser(input));
      }),

    adminUpdateOrganization: builder.adminUpdateOrganization
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.updateOrganization(input));
      }),

    adminDeleteOrganization: builder.adminDeleteOrganization
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.deleteOrganization(input.organizationId));
      }),

    adminAddMember: builder.adminAddMember
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.addMember(input));
      }),

    adminRemoveMember: builder.adminRemoveMember
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.removeMember(input));
      }),

    adminUpdateMemberRole: builder.adminUpdateMemberRole
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.updateMemberRole(input));
      }),

    adminCreateTeam: builder.adminCreateTeam
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.createTeam(input));
      }),

    adminUpdateTeam: builder.adminUpdateTeam
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.updateTeam(input));
      }),

    adminDeleteTeam: builder.adminDeleteTeam
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.deleteTeam(input.teamId));
      }),

    adminAddTeamMember: builder.adminAddTeamMember
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.addTeamMember(input));
      }),

    adminRemoveTeamMember: builder.adminRemoveTeamMember
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const admin = yield* AdminOrganizationsService;
        return yield* mapDomainError(admin.removeTeamMember(input));
      }),
  };
}
