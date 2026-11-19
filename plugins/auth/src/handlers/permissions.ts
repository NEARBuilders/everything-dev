import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { PermissionRegistryTag } from "../service-types";

export function createPermissionHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    getPermissionRegistry: builder.getPermissionRegistry.use(requireAuth).effect(function* () {
      const registry = yield* PermissionRegistryTag;
      return {
        statements: registry.statements,
        roles: registry.roleGrants,
        areas: registry.areas,
      };
    }),
  };
}
