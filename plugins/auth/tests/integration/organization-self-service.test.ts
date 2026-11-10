import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { createTestHandlers, createTestServices, createTestUser } from "../helpers";

let setup: Awaited<ReturnType<typeof createTestServices>>;
beforeAll(async () => {
  setup = await createTestServices();
}, 30000);
afterAll(async () => {
  await setup.driver.close();
});

/**
 * Organizations are born active (citynode#518 / NEARBuilders#857): self-service
 * creation needs no platform-admin approval, and every gate that used to read
 * the org status is gone. These tests pin the composed flows that motivated the
 * removal — create, invite, onboard — against the bare API surface.
 */
describe("organization creation is self-service", () => {
  async function createOrganizationFor(user: Awaited<ReturnType<typeof createTestUser>>) {
    const response = await setup.services.auth.handler(
      new Request("http://localhost:3000/api/auth/organization/create", {
        method: "POST",
        headers: { ...user.reqHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Self-service organization",
          slug: `self-${crypto.randomUUID()}`,
          status: "rejected",
          requestedBy: "someone-else",
          keepCurrentActiveOrganization: false,
        }),
      }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { id: string; name: string; slug: string };
  }

  it("creates the organization active with the creator as its active owner", async () => {
    const owner = await createTestUser(setup.services);
    const organization = await createOrganizationFor(owner);

    const stored = await setup.services.db.query.organization.findFirst({
      where: eq(schema.organization.id, organization.id),
    });
    expect(stored).toMatchObject({
      status: "active",
      requestedBy: null,
      rejectionReason: null,
    });

    const member = await setup.services.db.query.member.findFirst({
      where: and(
        eq(schema.member.organizationId, organization.id),
        eq(schema.member.userId, owner.userId),
      ),
    });
    expect(member?.role).toBe("owner");

    const session = await setup.services.db.query.session.findFirst({
      where: eq(schema.session.userId, owner.userId),
    });
    expect(session?.activeOrganizationId).toBe(organization.id);
  });

  it("ignores a forged status or requester in the create payload", async () => {
    const owner = await createTestUser(setup.services);
    const organization = await createOrganizationFor(owner);

    const stored = await setup.services.db.query.organization.findFirst({
      where: eq(schema.organization.id, organization.id),
    });
    expect(stored).toMatchObject({
      status: "active",
      requestedBy: null,
      rejectionReason: null,
    });
  });

  it("invites and accepts members on a freshly created organization", async () => {
    const owner = await createTestUser(setup.services);
    const recipient = await createTestUser(setup.services);
    const organization = await createOrganizationFor(owner);

    const invitation = await setup.services.auth.api.createInvitation({
      headers: owner.headers,
      body: { organizationId: organization.id, email: recipient.email, role: "member" },
    });
    await setup.services.auth.api.acceptInvitation({
      headers: recipient.headers,
      body: { invitationId: invitation.id },
    });
    const member = await setup.services.db.query.member.findFirst({
      where: and(
        eq(schema.member.organizationId, organization.id),
        eq(schema.member.userId, recipient.userId),
      ),
    });
    expect(member?.role).toBe("member");
  });

  it("runs the activation flow end-to-end: create org, create onboarding code, redeem", async () => {
    const owner = await createTestUser(setup.services);
    const joiner = await createTestUser(setup.services, { email: undefined });
    const organization = await createOrganizationFor(owner);
    const handlers = createTestHandlers(setup.services);

    const code = await handlers.onboarding.createOnboardingCode({
      input: {
        organizationId: organization.id,
        eventId: crypto.randomUUID(),
        eventName: "Community meetup",
      },
      context: { reqHeaders: owner.reqHeaders },
    });
    const result = await handlers.onboarding.redeemOnboardingCode({
      input: { code: code.code },
      context: { reqHeaders: joiner.reqHeaders },
    });

    expect(result.success).toBe(true);
    expect(result.organizationId).toBe(organization.id);
    const member = await setup.services.db.query.member.findFirst({
      where: and(
        eq(schema.member.organizationId, organization.id),
        eq(schema.member.userId, joiner.userId),
      ),
    });
    expect(member?.role).toBe("member");
    const teamMember = await setup.services.db.query.teamMember.findFirst({
      where: and(
        eq(schema.teamMember.teamId, code.teamId),
        eq(schema.teamMember.userId, joiner.userId),
      ),
    });
    expect(teamMember).toBeTruthy();
  });
});
