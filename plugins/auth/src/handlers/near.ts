import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { NearService } from "../services/near";
import { createHeaders } from "../utils";

export function createNearHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    nearNonce: builder.nearNonce.effect(function* ({ input }) {
      const near = yield* NearService;
      return yield* near.nearNonce(input);
    }),

    nearVerify: builder.nearVerify.effect(function* ({ input, context }) {
      const near = yield* NearService;
      return yield* near.nearVerify(createHeaders(context.reqHeaders), input);
    }),

    nearProfile: builder.nearProfile.use(requireAuth).effect(function* ({ input, context }) {
      const near = yield* NearService;
      return yield* near.nearProfile(createHeaders(context.reqHeaders), input.accountId);
    }),

    nearLinkAccount: builder.nearLinkAccount.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const near = yield* NearService;
      return yield* near.nearLinkAccount(createHeaders(context.reqHeaders), input);
    }),

    nearUnlinkAccount: builder.nearUnlinkAccount.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const near = yield* NearService;
      return yield* near.nearUnlinkAccount(createHeaders(context.reqHeaders), input);
    }),

    nearListAccounts: builder.nearListAccounts.use(requireAuth).effect(function* ({ context }) {
      const near = yield* NearService;
      return yield* near.nearListAccounts(createHeaders(context.reqHeaders));
    }),

    nearRelay: builder.nearRelay.use(requireAuth).effect(function* ({ input, context }) {
      const near = yield* NearService;
      return yield* near.nearRelay(createHeaders(context.reqHeaders), input.payload);
    }),

    nearRelayStatus: builder.nearRelayStatus.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const near = yield* NearService;
      return yield* near.nearRelayStatus(createHeaders(context.reqHeaders), input.txHash);
    }),

    nearRelayerInfo: builder.nearRelayerInfo.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const near = yield* NearService;
      return yield* near.nearRelayerInfo(createHeaders(context.reqHeaders), context, input?.network);
    }),

    nearRelayHistory: builder.nearRelayHistory.use(requireAuth).effect(function* ({ context }) {
      const near = yield* NearService;
      return yield* near.nearRelayHistory(createHeaders(context.reqHeaders));
    }),

    nearView: builder.nearView.use(requireAuth).effect(function* ({ input, context }) {
      const near = yield* NearService;
      return yield* near.nearView(createHeaders(context.reqHeaders), input);
    }),

    nearCheckSubAccountAvailability: builder.nearCheckSubAccountAvailability
      .use(requireAuth)
      .effect(function* ({ input, context }) {
        const near = yield* NearService;
        return yield* near.nearCheckSubAccountAvailability(createHeaders(context.reqHeaders), input);
      }),

    nearCreateSubAccount: builder.nearCreateSubAccount.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const near = yield* NearService;
      return yield* near.nearCreateSubAccount(createHeaders(context.reqHeaders), input);
    }),
  };
}
