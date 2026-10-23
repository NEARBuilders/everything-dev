import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/db/layer";
import * as schema from "../../src/db/schema";
import { isSyntheticEmail } from "../../src/synthetic-email";
import { createTestServices, createTestUser, type TestUser } from "../helpers";

const authOrigin = "http://localhost:3000";

interface TestServices {
  auth: { handler: (req: Request) => Promise<Response> };
  db: Database;
}

function authRequest(path: string, cookie: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("cookie", cookie);
  return new Request(`${authOrigin}/api/auth/${path}`, { ...init, headers });
}

async function setEmail(
  services: Pick<TestServices, "auth">,
  user: Pick<TestUser, "cookie">,
  email: string,
) {
  return services.auth.handler(
    authRequest("set-email", user.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
}

async function makeSyntheticEmailUser(db: Database, user: Pick<TestUser, "userId">) {
  const synthetic = `passkey-abcdef12@near.email`;
  await db.update(schema.user).set({ email: synthetic }).where(eq(schema.user.id, user.userId));
  return synthetic;
}

const drivers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  for (const driver of drivers.splice(0)) await driver.close();
  vi.unstubAllGlobals();
});

describe("set-email guards", () => {
  it("rejects an unauthenticated request", async () => {
    const { services, driver } = await createTestServices();
    drivers.push(driver);
    const res = await services.auth.handler(
      authRequest("set-email", "", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "newclaim@example.com" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a verified non-synthetic email", async () => {
    const { services, driver } = await createTestServices();
    drivers.push(driver);
    const user = await createTestUser(services, { email: "verified@example.com" });
    const res = await setEmail(services, user, "newclaim@example.com");
    expect(res.status).toBe(403);
  });

  it("rejects the same email", async () => {
    const { services, driver } = await createTestServices();
    drivers.push(driver);
    const user = await createTestUser(services, { email: "same@example.com" });
    const synthetic = await makeSyntheticEmailUser(services.db, user);
    const res = await setEmail(services, user, synthetic);
    expect(res.status).toBe(400);
  });

  it("rejects an email already used by another account", async () => {
    const { services, driver } = await createTestServices();
    drivers.push(driver);
    const claimant = await createTestUser(services, { email: "claimant@example.com" });
    const holder = await createTestUser(services, { email: "holder@example.com" });
    await makeSyntheticEmailUser(services.db, claimant);
    const res = await setEmail(services, claimant, holder.email);
    expect(res.status).toBe(400);
  });
});

describe("set-email without an email provider", () => {
  it("claims instantly for a synthetic email", async () => {
    const { services, driver } = await createTestServices();
    drivers.push(driver);
    const user = await createTestUser(services, { email: "synthetic-claimer@example.com" });
    const synthetic = await makeSyntheticEmailUser(services.db, user);
    expect(isSyntheticEmail(synthetic)).toBe(true);

    const res = await setEmail(services, user, "claimed@example.com");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: boolean; verificationRequired: boolean };
    expect(body).toEqual({ status: true, verificationRequired: false });

    const updated = await services.db.query.user.findFirst({
      where: eq(schema.user.email, "claimed@example.com"),
    });
    expect(updated?.id).toBe(user.userId);
    expect(updated?.emailVerified).toBe(true);
  });
});

describe("set-email with an email provider configured", () => {
  it("claims the email unverified, sends a verification email, and verifies on click", async () => {
    const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "https://api.resend.com/emails") {
          const body = JSON.parse(String(init?.body)) as {
            to: string;
            subject: string;
            text: string;
          };
          sentEmails.push(body);
          return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      }),
    );

    const { services, driver } = await createTestServices(
      { email: { from: "noreply@example.com" } },
      { email: { resend: "re_test_key" } },
    );
    drivers.push(driver);
    const user = await createTestUser(services, { email: "verify-claimer@example.com" });
    await makeSyntheticEmailUser(services.db, user);

    const res = await setEmail(services, user, "verified-claim@example.com");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: boolean; verificationRequired: boolean };
    expect(body).toEqual({ status: true, verificationRequired: true });

    const pending = await services.db.query.user.findFirst({
      where: eq(schema.user.email, "verified-claim@example.com"),
    });
    expect(pending?.id).toBe(user.userId);
    expect(pending?.emailVerified).toBe(false);

    const claimEmail = sentEmails.find((email) => email.to === "verified-claim@example.com");
    expect(claimEmail).toBeDefined();
    expect(claimEmail!.subject).toBe("Verify your email");

    const link = claimEmail!.text.split(" ").find((part) => part.includes("token="))!;
    const token = new URL(link).searchParams.get("token");
    expect(token).toBeTruthy();

    const confirmRes = await services.auth.handler(
      new Request(`${authOrigin}${new URL(link).pathname}?token=${encodeURIComponent(token!)}`),
    );
    expect(confirmRes.status).toBe(200);

    const verified = await services.db.query.user.findFirst({
      where: eq(schema.user.id, user.userId),
    });
    expect(verified?.email).toBe("verified-claim@example.com");
    expect(verified?.emailVerified).toBe(true);
  });
});
