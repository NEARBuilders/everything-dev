import { createHash, randomUUID } from "node:crypto";
import * as authSchema from "../../../../plugins/auth/src/db/schema.ts";
import { createAuthTestInstance } from "../../lib/auth-test-instance.ts";
import { computeRegressionEnv } from "../../lib/regression-env.mjs";

export type OnboardingCodeFixture = "valid" | "expired" | "revoked" | "usedUp";

const HOUR = 3_600_000;

function rawCode() {
  return randomUUID().replaceAll("-", "");
}

export async function seedOnboardingCodes(): Promise<{
  organizationName: string;
  eventName: string;
  codes: Record<OnboardingCodeFixture, string>;
}> {
  const regressionEnv = computeRegressionEnv();
  const { test, db, close } = await createAuthTestInstance({
    authDatabaseUrl: regressionEnv.dbUrls.AUTH_DATABASE_URL ?? "",
    secret: regressionEnv.authSecret,
  });
  try {
    const unique = randomUUID().slice(0, 8);
    const organizer = await test.saveUser(
      test.createUser({
        email: `regression-organizer-${unique}@citynode.test`,
        name: "Regression Organizer",
        emailVerified: true,
      }),
    );
    const organizationName = `regression-onboarding-${unique}`;
    const organization = await test.saveOrganization(
      test.createOrganization({ name: organizationName, slug: organizationName }),
    );
    const eventName = `Regression Night ${unique}`;
    const now = new Date();
    const [team] = await db
      .insert(authSchema.team)
      .values({
        id: randomUUID(),
        name: eventName,
        organizationId: organization.id,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const fixtures: Record<
      OnboardingCodeFixture,
      { expiresAt: Date; revokedAt: Date | null; usedCount: number }
    > = {
      valid: { expiresAt: new Date(now.getTime() + 24 * HOUR), revokedAt: null, usedCount: 0 },
      expired: { expiresAt: new Date(now.getTime() - HOUR), revokedAt: null, usedCount: 0 },
      revoked: { expiresAt: new Date(now.getTime() + 24 * HOUR), revokedAt: now, usedCount: 0 },
      usedUp: { expiresAt: new Date(now.getTime() + 24 * HOUR), revokedAt: null, usedCount: 5 },
    };
    const codes = {} as Record<OnboardingCodeFixture, string>;
    for (const [fixture, state] of Object.entries(fixtures) as Array<
      [OnboardingCodeFixture, (typeof fixtures)[OnboardingCodeFixture]]
    >) {
      const code = rawCode();
      codes[fixture] = code;
      await db.insert(authSchema.onboardingCode).values({
        id: randomUUID(),
        codeHash: createHash("sha256").update(code).digest("hex"),
        organizationId: organization.id,
        eventId: randomUUID(),
        eventName,
        teamId: team!.id,
        role: "member",
        maxUses: 5,
        usedCount: state.usedCount,
        expiresAt: state.expiresAt,
        revokedAt: state.revokedAt,
        createdBy: organizer.id,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { organizationName, eventName, codes };
  } finally {
    await close();
  }
}
