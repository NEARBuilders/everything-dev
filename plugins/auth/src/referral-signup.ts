import { tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";
import { defaultReferralCodeKey, signUpReferralStep } from "@marinedotsh/better-auth-referral";
import type { BetterAuthPlugin, User } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { AuthReferralConfig } from "./auth-config";

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{8}$/;

/**
 * Signup paths that carry the referral header on fresh-account flows. The
 * upstream plugin's hooks only cover /sign-up/email and OAuth, so wallet and
 * passkey attribution runs from databaseHooks.user.create.after instead —
 * this guard exists purely to reject bad codes before the signup ceremony.
 * Delete both once upstream supports configurable signup paths.
 */
const REFERRAL_SIGNUP_PATHS = ["/near/verify", "/passkey/generate-register-options"];

type ReferralAdapter = {
  findOne(params: {
    model: string;
    where: Array<{ field: string; value: unknown; operator?: string }>;
    select?: string[];
  }): Promise<unknown>;
  findMany(params: {
    model: string;
    where?: Array<{ field: string; value: unknown; operator?: string }>;
    select?: string[];
  }): Promise<unknown[]>;
  create(params: {
    model: string;
    data: Record<string, unknown>;
    select?: string[];
  }): Promise<unknown>;
  update(params: {
    model: string;
    where: Array<{ field: string; value: unknown; operator?: string }>;
    update: Record<string, unknown>;
  }): Promise<unknown>;
};

type ReferralEndpointContext = {
  headers: Headers;
  context: { adapter: ReferralAdapter };
};

export function isReferralCodeFormat(value: string): boolean {
  return REFERRAL_CODE_PATTERN.test(value);
}

function normalizeReferralCode(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toUpperCase();
  return isReferralCodeFormat(trimmed) ? trimmed : undefined;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  if ("cause" in error) return isUniqueConstraintError(error.cause);
  return false;
}

function generateReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function requiredSteps(options: AuthReferralConfig): string[] {
  return [...new Set([signUpReferralStep, ...(options.steps ?? [])])];
}

async function tryCreateReferralCode(adapter: ReferralAdapter, userId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await adapter.create({
        model: "referralCode",
        data: { userId, code: generateReferralCode() },
      });
      return;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await adapter.findOne({
        model: "referralCode",
        where: [{ field: "userId", value: userId }],
      });
      if (existing) return;
    }
  }
}

async function completeReferralStep(params: {
  adapter: ReferralAdapter;
  options: AuthReferralConfig;
  referral: { id: string; status: string };
  referrerUser: User;
  referredUser: User;
  step: string;
}): Promise<void> {
  const { adapter, options, referral, referrerUser, referredUser, step } = params;
  const completionKey = `${referral.id}:${step}`;
  const existing = await adapter.findOne({
    model: "referralStepCompletion",
    where: [{ field: "completionKey", value: completionKey }],
  });
  if (existing) return;

  try {
    await adapter.create({
      model: "referralStepCompletion",
      data: { referralId: referral.id, step, completionKey },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return;
  }

  const completions = await adapter.findMany({
    model: "referralStepCompletion",
    where: [{ field: "referralId", value: referral.id }],
    select: ["step"],
  });
  const completedSteps = new Set(completions.map((row) => (row as { step: string }).step));
  const allDone = requiredSteps(options).every((required) => completedSteps.has(required));

  if (allDone && referral.status !== "completed") {
    await adapter.update({
      model: "referrals",
      where: [
        { field: "id", value: referral.id },
        { field: "status", value: "pending" },
      ],
      update: { status: "completed", completedAt: new Date() },
    });
  }
  void referrerUser;
  void referredUser;
}

/**
 * Mirrors the upstream plugin's signup attribution (validate → record → issue
 * the referred user's code → complete the automatic sign_up step) for signup
 * paths its hooks do not cover. Runs from databaseHooks.user.create.after, so
 * it fires exactly once, at fresh-account creation, with the request header
 * reachable through the endpoint-context ALS — newness is inherent.
 */
export async function attributeReferralOnUserCreate(
  user: User,
  options: AuthReferralConfig = {},
): Promise<void> {
  const endpointContext = tryGetCurrentAuthEndpointContext() as ReferralEndpointContext | undefined;
  const adapter = endpointContext?.context?.adapter;
  if (!adapter || !endpointContext.headers) return;
  const code = normalizeReferralCode(endpointContext.headers.get(defaultReferralCodeKey));
  if (!code) return;

  try {
    const referrerCode = (await adapter.findOne({
      model: "referralCode",
      where: [{ field: "code", value: code }],
      select: ["id", "userId"],
    })) as { id: string; userId: string } | null;
    if (!referrerCode || referrerCode.userId === user.id) return;

    const existingReferral = await adapter.findOne({
      model: "referrals",
      where: [{ field: "referredUserId", value: user.id }],
      select: ["id"],
    });
    if (existingReferral) return;

    const createdReferral = (await adapter.create({
      model: "referrals",
      data: {
        referrerUserId: referrerCode.userId,
        referredUserId: user.id,
        referralCodeId: referrerCode.id,
        status: "pending",
        completedAt: null,
      },
      select: ["id", "status"],
    })) as { id: string; status: string };

    await tryCreateReferralCode(adapter, user.id);

    const referrerUser = (await adapter.findOne({
      model: "user",
      where: [{ field: "id", value: referrerCode.userId }],
    })) as User | null;
    if (!referrerUser) return;

    await completeReferralStep({
      adapter,
      options,
      referral: createdReferral,
      referrerUser,
      referredUser: user,
      step: signUpReferralStep,
    });
  } catch (error) {
    console.warn("[auth] Referral attribution failed:", error);
  }
}

export function referralSignupGuard(): BetterAuthPlugin {
  return {
    id: "referral-signup-guard",
    hooks: {
      before: REFERRAL_SIGNUP_PATHS.map((path) => ({
        matcher: (ctx) => ctx.path === path,
        handler: createAuthMiddleware(async (ctx) => {
          const raw = ctx.getHeader(defaultReferralCodeKey);
          if (raw === undefined || raw === null || raw === "") return;
          const code = normalizeReferralCode(raw);
          if (!code) {
            throw new APIError("BAD_REQUEST", { message: "Invalid referral code." });
          }
          const referralCode = await ctx.context.adapter.findOne({
            model: "referralCode",
            where: [{ field: "code", value: code }],
            select: ["id"],
          });
          if (!referralCode) {
            throw new APIError("BAD_REQUEST", { message: "Invalid referral code." });
          }
        }),
      })),
    },
  } satisfies BetterAuthPlugin;
}
