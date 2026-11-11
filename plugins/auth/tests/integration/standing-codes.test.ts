import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { createTestHandlers, createTestOrg, createTestServices, createTestUser } from "../helpers";

function standingInput(organizationId?: string) {
  return {
    eventId: undefined,
    eventName: undefined,
    organizationId,
    maxUses: 0,
    expiresAt: null,
  };
}

describe("standing onboarding codes", () => {
  it("create is idempotent on the canonical per-org slot", async () => {
    const { services } = await createTestServices();
    const owner = await createTestUser(services);
    const org = await createTestOrg(services, owner.userId);
    const handlers = createTestHandlers(services);

    const first = await handlers.onboarding.createOnboardingCode({
      input: standingInput(org.id),
      context: { reqHeaders: owner.reqHeaders },
    });
    const second = await handlers.onboarding.createOnboardingCode({
      input: standingInput(org.id),
      context: { reqHeaders: owner.reqHeaders },
    });

    expect(second.code).toBe(first.code);
    const standing = await services.db
      .select()
      .from(schema.onboardingCode)
      .where(
        and(
          eq(schema.onboardingCode.organizationId, org.id),
          isNull(schema.onboardingCode.revokedAt),
        ),
      );
    expect(standing).toHaveLength(1);
    expect(standing[0]?.maxUses).toBe(0);
    expect(standing[0]?.expiresAt).toBeNull();
  });

  it("lookup returns the code by organization without stored ids", async () => {
    const { services } = await createTestServices();
    const owner = await createTestUser(services);
    const org = await createTestOrg(services, owner.userId);
    const handlers = createTestHandlers(services);

    const created = await handlers.onboarding.createOnboardingCode({
      input: standingInput(org.id),
      context: { reqHeaders: owner.reqHeaders },
    });

    const found = await handlers.onboarding.getStandingOnboardingCode({
      input: { organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    expect(found).not.toBeNull();
    expect(found?.code).toBe(created.code);
    expect(found?.maxUses).toBe(0);
    expect(found?.expiresAt).toBeNull();

    const missing = await handlers.onboarding.getStandingOnboardingCode({
      input: { organizationId: org.id, eventId: "no-such-event" },
      context: { reqHeaders: owner.reqHeaders },
    });
    expect(missing).toBeNull();
  });

  it("rotate revokes the old code and issues a fresh one", async () => {
    const { services } = await createTestServices();
    const owner = await createTestUser(services);
    const org = await createTestOrg(services, owner.userId);
    const handlers = createTestHandlers(services);

    const original = await handlers.onboarding.createOnboardingCode({
      input: standingInput(org.id),
      context: { reqHeaders: owner.reqHeaders },
    });

    const rotated = await handlers.onboarding.rotateStandingOnboardingCode({
      input: { organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    expect(rotated.code).not.toBe(original.code);

    const found = await handlers.onboarding.getStandingOnboardingCode({
      input: { organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    expect(found?.code).toBe(rotated.code);

    const revoked = await services.db
      .select()
      .from(schema.onboardingCode)
      .where(eq(schema.onboardingCode.organizationId, org.id));
    const revokedOld = revoked.filter(
      (row) => row.revokedAt !== null && row.maxUses === 0 && row.expiresAt === null,
    );
    expect(revokedOld).toHaveLength(1);
  });

  it("standing codes redeem without limit or expiry across many users", async () => {
    const { services } = await createTestServices();
    const owner = await createTestUser(services);
    const org = await createTestOrg(services, owner.userId);
    const handlers = createTestHandlers(services);

    const standing = await handlers.onboarding.createOnboardingCode({
      input: standingInput(org.id),
      context: { reqHeaders: owner.reqHeaders },
    });

    for (let i = 0; i < 3; i++) {
      const joiner = await createTestUser(services, { email: undefined });
      const result = await handlers.onboarding.redeemOnboardingCode({
        input: { code: standing.code },
        context: { reqHeaders: joiner.reqHeaders },
      });
      expect(result.success).toBe(true);
    }

    const [row] = await services.db
      .select()
      .from(schema.onboardingCode)
      .where(eq(schema.onboardingCode.organizationId, org.id));
    expect(row?.usedCount).toBe(3);
  });
});
