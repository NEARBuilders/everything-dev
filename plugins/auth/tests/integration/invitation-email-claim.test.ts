import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/db/layer";
import * as schema from "../../src/db/schema";
import { createTestHandlers, createTestOrg, createTestServices, createTestUser } from "../helpers";

const authOrigin = "http://localhost:3000";

const drivers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  for (const driver of drivers.splice(0)) await driver.close();
  vi.unstubAllGlobals();
});

function authRequest(path: string, cookie: string, body: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${authOrigin}/api/auth/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

async function synthEmail(db: Database, userId: string) {
  const synthetic = `passkey-${crypto.randomUUID().slice(0, 8)}@near.email`;
  await db.update(schema.user).set({ email: synthetic }).where(eq(schema.user.id, userId));
  return synthetic;
}

describe("email invitations cannot be claimed by unverified wallet or passkey users", () => {
  it("rejects accept-invitation after a no-provider /set-email claim", async () => {
    const services = await createTestServices();
    drivers.push(services.driver);
    const auth = services.services.auth.handler;

    const owner = await createTestUser(services.services);
    const org = await createTestOrg(services.services, owner.userId);
    const handlers = createTestHandlers(services.services);
    const victimEmail = `victim-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const invite = await handlers.invitations.inviteMember({
      input: { email: victimEmail, role: "admin", organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });

    const attacker = await createTestUser(services.services);
    await synthEmail(services.services.db, attacker.userId);

    const claimRes = await auth(authRequest("set-email", attacker.cookie, { email: victimEmail }));
    expect(claimRes.status).toBe(200);
    const claimBody = (await claimRes.json()) as { emailVerified?: boolean };
    expect(claimBody.emailVerified).toBe(false);

    const acceptRes = await auth(
      authRequest("organization/accept-invitation", attacker.cookie, { invitationId: invite.id }),
    );
    expect(acceptRes.status).toBe(403);
    const acceptBody = (await acceptRes.json()) as { code?: string };
    expect(acceptBody.code).toBe(
      "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
    );

    const member = await services.services.db.query.member.findFirst({
      where: and(
        eq(schema.member.organizationId, org.id),
        eq(schema.member.userId, attacker.userId),
      ),
    });
    expect(member).toBeUndefined();
  });

  it("requires verification even with a provider configured, and unlocks after clicking the link", async () => {
    const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "https://api.resend.com/emails") {
          sentEmails.push(JSON.parse(init?.body as string));
          return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      }),
    );

    const services = await createTestServices(
      { email: { from: "noreply@example.com" } },
      { email: { resend: "re_test_key" } },
    );
    drivers.push(services.driver);
    const auth = services.services.auth.handler;

    const owner = await createTestUser(services.services);
    const org = await createTestOrg(services.services, owner.userId);
    const handlers = createTestHandlers(services.services);
    const victimEmail = `victim-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const invite = await handlers.invitations.inviteMember({
      input: { email: victimEmail, role: "member", organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });

    const claimer = await createTestUser(services.services);
    await synthEmail(services.services.db, claimer.userId);

    await auth(authRequest("set-email", claimer.cookie, { email: victimEmail }));

    const unverifiedRes = await auth(
      authRequest("organization/accept-invitation", claimer.cookie, { invitationId: invite.id }),
    );
    expect(unverifiedRes.status).toBe(403);

    const claimEmail = sentEmails.find(
      (email) => email.subject === "Verify your email" && email.to === victimEmail,
    );
    expect(claimEmail).toBeDefined();
    const link = claimEmail!.text.split(" ").find((part) => part.includes("token="))!;
    const token = new URL(link).searchParams.get("token");
    expect(token).toBeTruthy();
    await auth(
      new Request(`${authOrigin}${new URL(link).pathname}?token=${encodeURIComponent(token!)}`),
    );

    const acceptedRes = await auth(
      authRequest("organization/accept-invitation", claimer.cookie, { invitationId: invite.id }),
    );
    expect(acceptedRes.status).toBe(200);
    const accepted = await services.services.db.query.member.findFirst({
      where: and(
        eq(schema.member.organizationId, org.id),
        eq(schema.member.userId, claimer.userId),
      ),
    });
    expect(accepted?.role).toBe("member");
  });
});
