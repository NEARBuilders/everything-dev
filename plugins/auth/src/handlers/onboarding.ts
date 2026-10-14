import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { mapDomainError } from "../services/domain-errors";
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
      return yield* mapDomainError(onboarding.createOnboardingCode(context, input));
    }),

    listOnboardingCodes: builder.listOnboardingCodes.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* mapDomainError(onboarding.listOnboardingCodes(context, input?.organizationId));
    }),

    revokeOnboardingCode: builder.revokeOnboardingCode.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* mapDomainError(onboarding.revokeOnboardingCode(context, input));
    }),

    getOnboardingStation: builder.getOnboardingStation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* mapDomainError(onboarding.getOnboardingStation(context, input));
    }),

    getOnboardingStatus: builder.getOnboardingStatus.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* mapDomainError(onboarding.getOnboardingStatus(context, input));
    }),

    getOnboardingCodeInfo: builder.getOnboardingCodeInfo.effect(function* ({ input }) {
      const onboarding = yield* OnboardingService;
      return yield* mapDomainError(onboarding.getOnboardingCodeInfo(input.code));
    }),

    redeemOnboardingCode: builder.redeemOnboardingCode.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* mapDomainError(onboarding.redeemOnboardingCode(context, input.code));
    }),
  };
}
