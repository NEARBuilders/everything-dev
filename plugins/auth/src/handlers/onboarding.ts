import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { RateLimiterTag } from "../service-types";
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
      const limiter = yield* RateLimiterTag;
      yield* mapDomainError(limiter.enforce("createOnboardingCode", context.userId));
      const onboarding = yield* OnboardingService;
      return yield* mapDomainError(onboarding.createOnboardingCode(context, input));
    }),

    listOnboardingCodes: builder.listOnboardingCodes.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* mapDomainError(
        onboarding.listOnboardingCodes(context, {
          organizationId: input?.organizationId,
          eventId: input?.eventId,
        }),
      );
    }),

    getOnboardingStats: builder.getOnboardingStats.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const onboarding = yield* OnboardingService;
      return yield* mapDomainError(
        onboarding.getOnboardingStats(context, {
          month: input?.month,
          organizationId: input?.organizationId,
        }),
      );
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

    rotateStandingOnboardingCode: builder.rotateStandingOnboardingCode
      .use(requireAuth)
      .effect(function* ({ input, context }) {
        const onboarding = yield* OnboardingService;
        return yield* mapDomainError(onboarding.rotateStandingOnboardingCode(context, input));
      }),

    getStandingOnboardingCode: builder.getStandingOnboardingCode
      .use(requireAuth)
      .effect(function* ({ input, context }) {
        const onboarding = yield* OnboardingService;
        return yield* mapDomainError(onboarding.getStandingOnboardingCode(context, input));
      }),

    redeemOnboardingCode: builder.redeemOnboardingCode.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const limiter = yield* RateLimiterTag;
      yield* mapDomainError(limiter.enforce("redeemOnboardingCode", context.userId));
      const onboarding = yield* OnboardingService;
      return yield* mapDomainError(onboarding.redeemOnboardingCode(context, input.code));
    }),
  };
}
