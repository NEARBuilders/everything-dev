import { mapDomainError } from "../services/domain-errors";
import type { Implementer } from "@orpc/server";
import { Effect } from "effect";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { OrganizationsService } from "../services/organizations";
import { createHeaders } from "../utils";

export function createOrganizationHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    listOrganizations: builder.listOrganizations.use(requireAuth).effect(function* ({ context }) {
      const organizations = yield* OrganizationsService;
      return yield* mapDomainError(organizations.listOrganizations(createHeaders(context.reqHeaders)));
    }),

    getFullOrganization: builder.getFullOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const organizations = yield* OrganizationsService;
      return yield* mapDomainError(organizations.getFullOrganization(
        {
          headers: createHeaders(context.reqHeaders),
          reqHeaders: context.reqHeaders,
          user: context.user,
        },
        input,
      ));
    }),

    getOrganizationForAdmin: builder.getOrganizationForAdmin.use(requireAuth).effect(function* ({
      input,
      context,
      errors,
    }) {
      const organizations = yield* OrganizationsService;
      if (context.user.role !== "admin") {
        return yield* Effect.fail(
          errors.FORBIDDEN({ message: "Admin access required", data: { action: "admin-access" } }),
        );
      }
      return yield* mapDomainError(organizations.getOrganizationById(input.organizationId));
    }),

    createOrganization: builder.createOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const organizations = yield* OrganizationsService;
      return yield* mapDomainError(organizations.createOrganization(createHeaders(context.reqHeaders), input));
    }),

    setActiveOrganization: builder.setActiveOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const organizations = yield* OrganizationsService;
      yield* mapDomainError(organizations.setActiveOrganization(
        createHeaders(context.reqHeaders),
        input.organizationId,
      ));
      return { success: true };
    }),

    updateOrganization: builder.updateOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const organizations = yield* OrganizationsService;
      return yield* mapDomainError(organizations.updateOrganization(createHeaders(context.reqHeaders), input));
    }),

    leaveOrganization: builder.leaveOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const organizations = yield* OrganizationsService;
      yield* mapDomainError(organizations.leaveOrganization(
        createHeaders(context.reqHeaders),
        input.organizationId,
      ));
      return { success: true };
    }),

    deleteOrganization: builder.deleteOrganization.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const organizations = yield* OrganizationsService;
      yield* mapDomainError(organizations.deleteOrganization(
        createHeaders(context.reqHeaders),
        input.organizationId,
      ));
      return { success: true };
    }),

    checkSlug: builder.checkSlug.effect(function* ({ input }) {
      const organizations = yield* OrganizationsService;
      return yield* mapDomainError(organizations.checkSlug(input.slug));
    }),

    hasPermission: builder.hasPermission.use(requireAuth).effect(function* ({ input, context }) {
      const organizations = yield* OrganizationsService;
      return yield* mapDomainError(organizations.hasPermission(createHeaders(context.reqHeaders), input));
    }),

    linkDao: builder.linkDao.use(requireAuth).effect(function* ({ input, context }) {
      const organizations = yield* OrganizationsService;
      yield* mapDomainError(organizations.linkDao(createHeaders(context.reqHeaders), input));
      return { success: true };
    }),

    unlinkDao: builder.unlinkDao.use(requireAuth).effect(function* ({ input, context }) {
      const organizations = yield* OrganizationsService;
      yield* mapDomainError(organizations.unlinkDao(createHeaders(context.reqHeaders), input));
      return { success: true };
    }),

    getDao: builder.getDao.use(requireAuth).effect(function* ({ input, context }) {
      const organizations = yield* OrganizationsService;
      return yield* mapDomainError(organizations.getDao(createHeaders(context.reqHeaders), input.organizationId));
    }),
  };
}
