import type { WithEffectContext } from "@orpc/experimental-effect";
import type { Implementer } from "@orpc/server";
import { type AuthContextShape, createAuthMiddleware } from "everything-dev/api";
import type { ContractType } from "../contract";
import type {
  AuthEffectServices,
  AuthHandlerAuthedContext,
  AuthHandlerContext,
  RequireAuthMiddleware,
} from "../middleware";
import { mapDomainError } from "../services/domain-errors";
import { MembersService } from "../services/members";

export type OrganizationRequestContext = AuthContextShape &
  WithEffectContext<AuthEffectServices> & { reqHeaders?: Record<string, string> };

export function createOrganizationRequestHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  const { requireAdmin } = createAuthMiddleware<AuthHandlerAuthedContext>(builder);
  return {
    listOrganizationRequests: builder.listOrganizationRequests
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* () {
        const members = yield* MembersService;
        return yield* mapDomainError(members.listPendingOrganizations());
      }),
    reviewOrganization: builder.reviewOrganization
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const members = yield* MembersService;
        return yield* mapDomainError(members.reviewOrganization(input));
      }),
  };
}
