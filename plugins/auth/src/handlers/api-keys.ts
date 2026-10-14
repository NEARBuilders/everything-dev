import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { ApiKeysService } from "../services/api-keys";
import { mapDomainError } from "../services/domain-errors";
import { createHeaders } from "../utils";

export function createApiKeyHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    listApiKeys: builder.listApiKeys.use(requireAuth).effect(function* ({ input, context }) {
      const apiKeys = yield* ApiKeysService;
      return yield* mapDomainError(apiKeys.listApiKeys(createHeaders(context.reqHeaders), input));
    }),

    createApiKey: builder.createApiKey.use(requireAuth).effect(function* ({ input, context }) {
      const apiKeys = yield* ApiKeysService;
      return yield* mapDomainError(apiKeys.createApiKey(context.userId, input));
    }),

    updateApiKey: builder.updateApiKey.use(requireAuth).effect(function* ({ input, context }) {
      const apiKeys = yield* ApiKeysService;
      return yield* mapDomainError(apiKeys.updateApiKey(context.userId, input));
    }),

    deleteApiKey: builder.deleteApiKey.use(requireAuth).effect(function* ({ input, context }) {
      const apiKeys = yield* ApiKeysService;
      return yield* mapDomainError(apiKeys.deleteApiKey(createHeaders(context.reqHeaders), input));
    }),

    verifyApiKey: builder.verifyApiKey.effect(function* ({ input, context }) {
      const apiKeys = yield* ApiKeysService;
      return yield* mapDomainError(apiKeys.verifyApiKey(createHeaders(context.reqHeaders), input));
    }),
  };
}
