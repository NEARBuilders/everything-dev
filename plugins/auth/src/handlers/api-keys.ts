import type { Implementer } from "@orpc/server";
import { Effect } from "effect";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { ApiKeysService } from "../services/api-keys";
import { mapDomainError } from "../services/domain-errors";
import { NearService } from "../services/near";
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

    createDeployKey: builder.createDeployKey.use(requireAuth).effect(function* ({
      input,
      context,
      errors,
    }) {
      const near = yield* NearService;
      const linked = yield* mapDomainError(
        near.nearListAccounts(createHeaders(context.reqHeaders)),
      );
      const linkedAccounts = new Set((linked.accounts ?? []).map((account) => account.accountId));
      if (!linkedAccounts.has(input.account)) {
        return yield* Effect.fail(
          errors.FORBIDDEN({
            message: `Deploy keys can only be minted for NEAR accounts linked to your login — link ${input.account} first`,
            data: { action: `deploy-key ${input.account}/${input.gateway}` },
          }),
        );
      }
      const apiKeys = yield* ApiKeysService;
      return yield* mapDomainError(apiKeys.createDeployKey(context.userId, input));
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
