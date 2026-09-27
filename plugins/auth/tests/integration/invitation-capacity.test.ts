import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { createTestHandlers, createTestOrg, createTestServices, createTestUser } from "../helpers";

let fixture: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  fixture = await createTestServices({ organizationMembershipLimit: 2 });
}, 30000);

afterAll(async () => {
  await fixture?.driver.close();
}, 30000);

async function invitationsForLastSlot() {
  const owner = await createTestUser(fixture.services);
  const organization = await createTestOrg(fixture.services, owner.userId);
  const handlers = createTestHandlers(fixture.services);
  const wallets = [];
  for (let index = 0; index < 2; index++) {
    const user = await createTestUser(fixture.services);
    const accountId = `capacity-${crypto.randomUUID().slice(0, 8)}.near`;
    await fixture.services.db.insert(schema.nearAccount).values({
      id: crypto.randomUUID(),
      userId: user.userId,
      accountId,
      network: "mainnet",
      publicKey: "ed25519:test",
      isPrimary: true,
      createdAt: new Date(),
    });
    const invitation = await handlers.invitations.inviteMember({
      input: {
        organizationId: organization.id,
        role: "member",
        nearAccountId: accountId,
        nearNetwork: "mainnet",
      },
      context: { reqHeaders: owner.reqHeaders },
    });
    wallets.push({ user, invitation });
  }
  return { owner, organization, handlers, wallets };
}

describe("organization invitation capacity", () => {
  it("applies the same membership limit to email and wallet acceptance", async () => {
    const { owner, organization, handlers, wallets } = await invitationsForLastSlot();
    const emailUser = await createTestUser(fixture.services);
    const emailInvitation = await handlers.invitations.inviteMember({
      input: { organizationId: organization.id, role: "member", email: emailUser.email },
      context: { reqHeaders: owner.reqHeaders },
    });
    const [first, second] = wallets;
    if (!first || !second) throw new Error("Expected two wallet invitees");

    await handlers.invitations.acceptNearInvitation({
      input: { invitationId: first.invitation.id },
      context: { reqHeaders: first.user.reqHeaders },
    });
    await expect(
      handlers.invitations.acceptNearInvitation({
        input: { invitationId: second.invitation.id },
        context: { reqHeaders: second.user.reqHeaders },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      handlers.invitations.acceptInvitation({
        input: { invitationId: emailInvitation.id },
        context: { reqHeaders: emailUser.reqHeaders },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const listed = await handlers.invitations.listInvitations({
      input: { organizationId: organization.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: second.invitation.id, status: "pending" }),
        expect.objectContaining({ id: emailInvitation.id, status: "pending" }),
      ]),
    );
  });

  it("admits only one of two wallet invitees competing for the last slot", async () => {
    const { owner, organization, handlers, wallets } = await invitationsForLastSlot();
    const results = await Promise.allSettled(
      wallets.map(({ user, invitation }) =>
        handlers.invitations.acceptNearInvitation({
          input: { invitationId: invitation.id },
          context: { reqHeaders: user.reqHeaders },
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "FORBIDDEN" }) }),
    ]);
    const members = await fixture.services.auth.api.listMembers({
      headers: owner.headers,
      query: { organizationId: organization.id },
    });
    expect(members.total).toBe(2);
  });
});
