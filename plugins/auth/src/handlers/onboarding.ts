import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { OnboardingService } from "../services/onboarding";

export function createOnboardingHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    createOnboardingCode: builder.createOnboardingCode.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* onboarding.createOnboardingCode(context, input);
    }),

    listOnboardingCodes: builder.listOnboardingCodes.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* onboarding.listOnboardingCodes(context, input?.organizationId);
    }),

    revokeOnboardingCode: builder.revokeOnboardingCode.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* onboarding.revokeOnboardingCode(context, input);
    }),

    getOnboardingStation: builder.getOnboardingStation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* onboarding.getOnboardingStation(context, input);
    }),

    getOnboardingStatus: builder.getOnboardingStatus.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* onboarding.getOnboardingStatus(context, input);
    }),

    getOnboardingCodeInfo: builder.getOnboardingCodeInfo.effect(function* ({ input }) {
      const onboarding = yield* OnboardingService;
      return yield* onboarding.getOnboardingCodeInfo(input.code);
    }),

    redeemOnboardingCode: builder.redeemOnboardingCode.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* onboarding.redeemOnboardingCode(context, input.code);
    }),
  };
}
