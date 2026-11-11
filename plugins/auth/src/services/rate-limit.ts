import { Context, Effect } from "effect";
import { RateLimitExceeded } from "./domain-errors";

export type RateLimitOperation =
  | "createOrganization"
  | "createOnboardingCode"
  | "redeemOnboardingCode";

export interface RateRule {
  window: number;
  max: number;
}

export type RateRules = Partial<Record<RateLimitOperation, RateRule>>;

export type RateLimiterService = typeof RateLimiter.Service;

export class RateLimiter extends Context.Service<
  RateLimiter,
  {
    enforce: (
      operation: RateLimitOperation,
      subject: string,
    ) => Effect.Effect<void, RateLimitExceeded>;
  }
>()("auth/RateLimiter") {}

export const createRateLimiter = (rules: RateRules = {}): RateLimiterService => {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    enforce: (operation, subject) =>
      Effect.gen(function* () {
        const rule = rules[operation];
        if (!rule) return;

        const now = Date.now();
        if (buckets.size > 256) {
          for (const [key, bucket] of buckets) {
            if (bucket.resetAt <= now) buckets.delete(key);
          }
        }
        const key = `${operation}:${subject}`;
        const bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
          buckets.set(key, { count: 1, resetAt: now + rule.window * 1000 });
          return;
        }
        if (bucket.count < rule.max) {
          bucket.count += 1;
          return;
        }
        return yield* new RateLimitExceeded({
          message: "Too many requests. Try again later.",
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        });
      }),
  };
};
