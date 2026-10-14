import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import { onboardingCodeSummarySchema } from "./schemas";

export const onboardingRoutes = {
  createOnboardingCode: oc
    .route({ method: "POST", path: "/v1/auth/onboarding/codes" })
    .input(
      z.object({
        eventId: z.string().min(1).max(200),
        eventName: z.string().trim().min(1).max(160),
        organizationId: z.string().optional(),
        maxUses: z.number().int().min(1).max(500).optional(),
        expiresAt: z.date().optional(),
      }),
    )
    .output(onboardingCodeSummarySchema.extend({ code: z.string() }))
    .errors(Errors),

  listOnboardingCodes: oc
    .route({ method: "GET", path: "/v1/auth/onboarding/codes" })
    .input(
      z.object({
        organizationId: z.string().optional(),
      }),
    )
    .output(z.array(onboardingCodeSummarySchema))
    .errors(Errors),

  revokeOnboardingCode: oc
    .route({ method: "POST", path: "/v1/auth/onboarding/codes/revoke" })
    .input(
      z.object({
        codeId: z.string(),
        organizationId: z.string().optional(),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  getOnboardingStation: oc
    .route({ method: "GET", path: "/v1/auth/onboarding/codes/station" })
    .input(
      z.object({
        codeId: z.string(),
        organizationId: z.string().optional(),
      }),
    )
    .output(onboardingCodeSummarySchema.extend({ code: z.string() }))
    .errors(Errors),

  getOnboardingStatus: oc
    .route({ method: "GET", path: "/v1/auth/onboarding/codes/status" })
    .input(
      z.object({
        codeId: z.string(),
        organizationId: z.string().optional(),
      }),
    )
    .output(
      onboardingCodeSummarySchema.extend({
        joined: z.array(
          z.object({
            userId: z.string(),
            userName: z.string().nullable(),
            accountId: z.string().nullable(),
            createdAt: z.date(),
          }),
        ),
      }),
    )
    .errors(Errors),

  getOnboardingCodeInfo: oc
    .route({ method: "GET", path: "/v1/auth/onboarding/info" })
    .input(z.object({ code: z.string().min(1) }))
    .output(
      z
        .object({
          organizationName: z.string(),
          eventName: z.string(),
          inviterName: z.string().nullable(),
          role: z.string(),
          expired: z.boolean(),
          revoked: z.boolean(),
          usedUp: z.boolean(),
        })
        .nullable(),
    )
    .errors(Errors),

  redeemOnboardingCode: oc
    .route({ method: "POST", path: "/v1/auth/onboarding/redeem" })
    .input(z.object({ code: z.string().min(1) }))
    .output(
      z.object({
        success: z.boolean(),
        alreadyRedeemed: z.boolean(),
        organizationName: z.string(),
        eventName: z.string(),
      }),
    )
    .errors(Errors),
};
