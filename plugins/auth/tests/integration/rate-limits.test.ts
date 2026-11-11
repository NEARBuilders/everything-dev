import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../../src/services/rate-limit";
import { createTestHandlers, createTestOrg, createTestServices, createTestUser } from "../helpers";

describe("rate limiter", () => {
  it("blocks past the configured max and reports retryAfterSeconds", async () => {
    const limiter = createRateLimiter({ createOrganization: { window: 60, max: 1 } });

    const first = await limiter
      .enforce("createOrganization", "user-1")
      .pipe(
        Effect.map(() => "allowed"),
        Effect.catchTag("RateLimitExceeded", (error) =>
          Effect.succeed(`blocked:${error.retryAfterSeconds}`),
        ),
      )
      .pipe(Effect.runPromise);

    expect(first).toBe("allowed");

    const second = await limiter
      .enforce("createOrganization", "user-1")
      .pipe(
        Effect.map(() => "allowed"),
        Effect.catchTag("RateLimitExceeded", (error) =>
          Effect.succeed(`blocked:${error.retryAfterSeconds}`),
        ),
      )
      .pipe(Effect.runPromise);

    expect(second).toMatch(/^blocked:\d+$/);

    const otherUser = await limiter.enforce("createOrganization", "user-2").pipe(
      Effect.map(() => "allowed"),
      Effect.runPromise,
    );
    expect(otherUser).toBe("allowed");
  });

  it("is a no-op for operations without configured rules", async () => {
    const limiter = createRateLimiter({});
    for (let i = 0; i < 5; i++) {
      const outcome = await limiter
        .enforce("redeemOnboardingCode", "user-1")
        .pipe(Effect.runPromise);
      expect(outcome).toBeUndefined();
    }
  });
});

describe("abuse-control wiring", () => {
  it("rate limits organization creation per configured rule", async () => {
    const { services } = await createTestServices({
      abuseControl: {
        rateLimits: { createOrganization: { window: 60, max: 1 } },
      },
    });
    const owner = await createTestUser(services);
    const handlers = createTestHandlers(services);

    await handlers.organizations.createOrganization({
      input: { name: "First", slug: `rl-a-${crypto.randomUUID().slice(0, 8)}` },
      context: { reqHeaders: owner.reqHeaders },
    });

    const error = (await handlers.organizations
      .createOrganization({
        input: { name: "Second", slug: `rl-${crypto.randomUUID().slice(0, 8)}` },
        context: { reqHeaders: owner.reqHeaders },
      })
      .catch((e: unknown) => e)) as {
      code?: string;
      data?: Record<string, unknown>;
    };

    expect(String(error.code)).toBe("RATE_LIMITED");
    expect(error.data).toMatchObject({ retryAfterSeconds: expect.any(Number) });
  });

  it("rate limits onboarding code redemption", async () => {
    const { services } = await createTestServices({
      abuseControl: {
        rateLimits: { redeemOnboardingCode: { window: 60, max: 1 } },
      },
    });
    const owner = await createTestUser(services);
    const org = await createTestOrg(services, owner.userId);
    const handlers = createTestHandlers(services);

    const code = await handlers.onboarding.createOnboardingCode({
      input: { organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });

    await handlers.onboarding.redeemOnboardingCode({
      input: { code: code.code },
      context: { reqHeaders: owner.reqHeaders },
    });

    const error = (await handlers.onboarding
      .redeemOnboardingCode({
        input: { code: code.code },
        context: { reqHeaders: owner.reqHeaders },
      })
      .catch((e: unknown) => e)) as { code?: string };

    expect(error.code).toBe("RATE_LIMITED");
  });
});
