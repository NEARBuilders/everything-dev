import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestHandlers, createTestOrg, createTestServices, createTestUser } from "../helpers";

let services: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  services = await createTestServices();
}, 30000);

afterAll(async () => {
  await services.driver.close();
}, 30000);

async function orgWithTeam() {
  const owner = await createTestUser(services.services);
  const org = await createTestOrg(services.services, owner.userId);
  const handlers = createTestHandlers(services.services);
  const team = await handlers.teams.createTeam({
    input: { name: "Finance", organizationId: org.id, areas: ["finance"] },
    context: { reqHeaders: owner.reqHeaders },
  });
  return { owner, org, team, handlers };
}

describe("team-targeted email invitations", () => {
  it("stores the target team on the invitation and shows it in listings", async () => {
    const { owner, org, team, handlers } = await orgWithTeam();

    const invitation = await handlers.invitations.inviteMember({
      input: {
        email: "finance-hire@example.com",
        role: "member",
        organizationId: org.id,
        teamId: team.id,
      },
      context: { reqHeaders: owner.reqHeaders },
    });

    expect(invitation.teamId).toBe(team.id);
    const listed = await handlers.invitations.listInvitations({
      input: { organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    expect(listed).toEqual([expect.objectContaining({ id: invitation.id, teamId: team.id })]);
  });

  it("joins the team and makes it the active team on acceptance", async () => {
    const { owner, org, team, handlers } = await orgWithTeam();
    const invitee = await createTestUser(services.services);
    const invitation = await handlers.invitations.inviteMember({
      input: { email: invitee.email, role: "member", organizationId: org.id, teamId: team.id },
      context: { reqHeaders: owner.reqHeaders },
    });

    await handlers.invitations.acceptInvitation({
      input: { invitationId: invitation.id },
      context: { reqHeaders: invitee.reqHeaders },
    });

    const context = await handlers.session.getContext({
      context: { reqHeaders: invitee.reqHeaders },
    });
    expect(context.organization.activeOrganizationId).toBe(org.id);
    expect(context.organization.activeTeamId).toBe(team.id);
    expect(context.organization.teams).toEqual([
      { id: team.id, name: "Finance", areas: ["finance"] },
    ]);
  });

  it("accepts an invitation without a team as before", async () => {
    const { owner, org, handlers } = await orgWithTeam();
    const invitee = await createTestUser(services.services);
    const invitation = await handlers.invitations.inviteMember({
      input: { email: invitee.email, role: "member", organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });

    expect(invitation.teamId).toBeNull();
    await handlers.invitations.acceptInvitation({
      input: { invitationId: invitation.id },
      context: { reqHeaders: invitee.reqHeaders },
    });

    const context = await handlers.session.getContext({
      context: { reqHeaders: invitee.reqHeaders },
    });
    expect(context.organization.activeOrganizationId).toBe(org.id);
    expect(context.organization.member?.role).toBe("member");
    expect(context.organization.teams).toEqual([]);
    expect(context.organization.activeTeamId).toBeNull();
  });

  it("links invitation emails to the invitation acceptance page", async () => {
    const { owner, org, handlers } = await orgWithTeam();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const invitation = await handlers.invitations.inviteMember({
        input: { email: "linked@example.com", role: "member", organizationId: org.id },
        context: { reqHeaders: owner.reqHeaders },
      });

      const printed = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(printed).toContain(`http://localhost:3000/orgs/invites/${invitation.id}`);
      expect(printed).not.toContain("/accept-invitation/");
    } finally {
      log.mockRestore();
    }
  });
});
