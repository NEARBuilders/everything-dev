import { mapDomainError } from "../services/domain-errors";
import type { Implementer } from "@orpc/server";
import { createAuthMiddleware } from "everything-dev/api";
import type { ContractType } from "../contract";
import type {
  AuthHandlerAuthedContext,
  AuthHandlerContext,
  RequireAuthMiddleware,
} from "../middleware";
import { NearService } from "../services/near";
import { createHeaders } from "../utils";

export function createNearHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  const { requireAdmin } = createAuthMiddleware<AuthHandlerAuthedContext>(builder);
  return {
    nearNonce: builder.nearNonce.effect(function* ({ input }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearNonce(input));
    }),

    nearVerify: builder.nearVerify.effect(function* ({ input, context }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearVerify(createHeaders(context.reqHeaders), input));
    }),

    nearProfile: builder.nearProfile.use(requireAuth).effect(function* ({ input, context }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearProfile(createHeaders(context.reqHeaders), input.accountId));
    }),

    nearLinkAccount: builder.nearLinkAccount.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearLinkAccount(createHeaders(context.reqHeaders), input));
    }),

    nearUnlinkAccount: builder.nearUnlinkAccount.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearUnlinkAccount(createHeaders(context.reqHeaders), input));
    }),

    nearListAccounts: builder.nearListAccounts.use(requireAuth).effect(function* ({ context }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearListAccounts(createHeaders(context.reqHeaders)));
    }),

    nearRelay: builder.nearRelay.use(requireAuth).effect(function* ({ input, context }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearRelay(createHeaders(context.reqHeaders), input.payload));
    }),

    nearRelayStatus: builder.nearRelayStatus.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearRelayStatus(createHeaders(context.reqHeaders), input.txHash));
    }),

    nearRelayerInfo: builder.nearRelayerInfo
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, context }) {
        const near = yield* NearService;
        return yield* mapDomainError(near.nearRelayerInfo(createHeaders(context.reqHeaders), input?.network));
      }),

    nearRelayHistory: builder.nearRelayHistory.use(requireAuth).effect(function* ({ context }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearRelayHistory(createHeaders(context.reqHeaders)));
    }),

    nearView: builder.nearView.use(requireAuth).effect(function* ({ input, context }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearView(createHeaders(context.reqHeaders), input));
    }),

    nearCheckSubAccountAvailability: builder.nearCheckSubAccountAvailability
      .use(requireAuth)
      .effect(function* ({ input, context }) {
        const near = yield* NearService;
        return yield* mapDomainError(near.nearCheckSubAccountAvailability(
          createHeaders(context.reqHeaders),
          input,
        ));
      }),

    nearCreateSubAccount: builder.nearCreateSubAccount.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const near = yield* NearService;
      return yield* mapDomainError(near.nearCreateSubAccount(createHeaders(context.reqHeaders), input));
    }),
  };
}
