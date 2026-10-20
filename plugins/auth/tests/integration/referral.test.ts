import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { createTestServices, TEST_PERMISSIONS } from "../helpers";

const BASE = "http://localhost:3000/api/auth";

async function createReferrerWithCode(
  services: Awaited<ReturnType<typeof createTestServices>>["services"],
  code: string,
): Promise<{ userId: string }> {
  const email = `referrer-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await services.auth.api.signUpEmail({
    body: { email, password: "Test1234!", name: "Referrer" },
  });
  const user = await services.db.query.user.findFirst({ where: eq(schema.user.email, email) });
  expect(user).toBeDefined();
  await services.db
    .insert(schema.referralCode)
    .values({ id: crypto.randomUUID(), userId: user!.id, code, createdAt: new Date() });
  return { userId: user!.id };
}

async function signUpWithReferral(
  services: Awaited<ReturnType<typeof createTestServices>>["services"],
  referralHeader?: Record<string, string>,
): Promise<Response> {
  const email = `referred-${crypto.randomUUID().slice(0, 8)}@example.com`;
  return services.auth.handler(
    new Request(`${BASE}/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(referralHeader ?? {}) },
      body: JSON.stringify({ email, password: "Test1234!", name: "Referred" }),
    }),
  );
}

describe("referral attribution", () => {
  it("records the referral and issues the new user's code on referred signup", async () => {
    const { services, driver } = await createTestServices();
    const { userId: referrerId } = await createReferrerWithCode(services, "REFERR01");

    const res = await signUpWithReferral(services, { "x-referral-code": "REFERR01" });
    expect(res.status).toBe(200);

    const referred = await services.db.query.user.findFirst({
      where: eq(schema.user.name, "Referred"),
    });
    expect(referred).toBeDefined();

    const referral = await services.db.query.referrals.findFirst({
      where: eq(schema.referrals.referredUserId, referred!.id),
    });
    expect(referral).toMatchObject({
      referrerUserId: referrerId,
      referredUserId: referred!.id,
      status: "completed",
    });
    expect(referral?.completedAt).not.toBeNull();

    const step = await services.db.query.referralStepCompletion.findFirst({
      where: eq(schema.referralStepCompletion.referralId, referral!.id),
    });
    expect(step?.step).toBe("sign_up");

    const newUserCode = await services.db.query.referralCode.findFirst({
      where: eq(schema.referralCode.userId, referred!.id),
    });
    expect(newUserCode?.code).toMatch(/^[A-Z0-9]{8}$/);

    await driver.close();
  });

  it("does not attribute signups without a referral header", async () => {
    const { services, driver } = await createTestServices();

    const res = await signUpWithReferral(services);
    expect(res.status).toBe(200);

    const users = await services.db.select().from(schema.user);
    for (const user of users) {
      const referral = await services.db.query.referrals.findFirst({
        where: eq(schema.referrals.referredUserId, user.id),
      });
      expect(referral).toBeUndefined();
    }

    await driver.close();
  });

  it("keeps the referral pending when custom steps are configured", async () => {
    const { services, driver } = await createTestServices({
      referral: { steps: ["first_purchase"] },
    });
    await createReferrerWithCode(services, "REFERR02");

    const res = await signUpWithReferral(services, { "x-referral-code": "REFERR02" });
    expect(res.status).toBe(200);

    const referred = await services.db.query.user.findFirst({
      where: eq(schema.user.name, "Referred"),
    });
    const referral = await services.db.query.referrals.findFirst({
      where: eq(schema.referrals.referredUserId, referred!.id),
    });
    expect(referral?.status).toBe("pending");
    expect(referral?.completedAt).toBeNull();

    const steps = await services.db.query.referralStepCompletion.findMany({
      where: eq(schema.referralStepCompletion.referralId, referral!.id),
    });
    expect(steps.map((row) => row.step)).toEqual(["sign_up"]);

    await driver.close();
  });

  it("guard rejects unknown and malformed codes on /near/verify before verification", async () => {
    const { services, driver } = await createTestServices();
    await createReferrerWithCode(services, "REFERR03");

    const verifyBody = {
      signedMessage: {
        accountId: "alice.test.near",
        publicKey: "ed25519:AaA",
        signature: "AAAA",
      },
      message: "Sign in to test.near",
      recipient: "test.near",
      nonce: "AAAA",
      accountId: "alice.test.near",
    };

    const unknown = await services.auth.handler(
      new Request(`${BASE}/near/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-referral-code": "UNKNOWN9" },
        body: JSON.stringify(verifyBody),
      }),
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      message: "Invalid referral code.",
    });

    const malformed = await services.auth.handler(
      new Request(`${BASE}/near/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-referral-code": "nope code" },
        body: JSON.stringify(verifyBody),
      }),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      message: "Invalid referral code.",
    });

    await driver.close();
  });

  it("guard lets a valid code through to the endpoint", async () => {
    const { services, driver } = await createTestServices();
    await createReferrerWithCode(services, "REFERR04");

    const res = await services.auth.handler(
      new Request(`${BASE}/near/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-referral-code": "REFERR04" },
        body: JSON.stringify({
          signedMessage: {
            accountId: "alice.test.near",
            publicKey: "ed25519:AaA",
            signature: "AAAA",
          },
          message: "Sign in to test.near",
          recipient: "test.near",
          nonce: "AAAA",
          accountId: "alice.test.near",
        }),
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message?: string };
    expect(body.message).not.toBe("Invalid referral code.");

    await driver.close();
  });
});
