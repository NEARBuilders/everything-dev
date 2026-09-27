import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTestMember,
  createTestHandlers,
  createTestOrg,
  createTestServices,
  createTestUser,
} from "../helpers";

let services: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  services = await createTestServices();
}, 30000);

afterAll(async () => {
  await services.driver.close();
}, 30000);

async function orgWithTeamMember(areas: string[] = ["node-operations"]) {
  const owner = await createTestUser(services.services);
  const member = await createTestUser(services.services);
  const org = await createTestOrg(services.services, owner.userId);
  await addTestMember(services.services, org.id, member.userId, "member");
  const handlers = createTestHandlers(services.services);
  const team = await handlers.teams.createTeam({
    input: { name: "Node Operator", organizationId: org.id, areas },
    context: { reqHeaders: owner.reqHeaders },
  });
  await handlers.teams.addTeamMember({
    input: { teamId: team.id, userId: member.userId, organizationId: org.id },
    context: { reqHeaders: owner.reqHeaders },
  });
  await handlers.organizations.setActiveOrganization({
    input: { organizationId: org.id },
    context: { reqHeaders: member.reqHeaders },
  });
  return { owner, member, org, team, handlers };
}

describe("team context", () => {
  it("reports the member's teams and the active team after setting it", async () => {
    const { member, team, handlers } = await orgWithTeamMember(["node-operations", "finance"]);

    await handlers.teams.setActiveTeam({
      input: { teamId: team.id },
      context: { reqHeaders: member.reqHeaders },
    });

    const context = await handlers.session.getContext({
      context: { reqHeaders: member.reqHeaders },
    });

    expect(context.organization.teams).toEqual([
      { id: team.id, name: "Node Operator", areas: ["node-operations", "finance"] },
    ]);
    expect(context.organization.activeTeamId).toBe(team.id);
  });

  it("drops an active team the member was removed from", async () => {
    const { owner, member, org, team, handlers } = await orgWithTeamMember();
    await handlers.teams.setActiveTeam({
      input: { teamId: team.id },
      context: { reqHeaders: member.reqHeaders },
    });

    await handlers.teams.removeTeamMember({
      input: { teamId: team.id, userId: member.userId, organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });

    const context = await handlers.session.getContext({
      context: { reqHeaders: member.reqHeaders },
    });
    expect(context.organization.teams).toEqual([]);
    expect(context.organization.activeTeamId).toBeNull();
  });

  it("drops an active team that belongs to a different organization", async () => {
    const { member, team, handlers } = await orgWithTeamMember();
    await handlers.teams.setActiveTeam({
      input: { teamId: team.id },
      context: { reqHeaders: member.reqHeaders },
    });
    const otherOrg = await createTestOrg(services.services, member.userId);

    await handlers.organizations.setActiveOrganization({
      input: { organizationId: otherOrg.id },
      context: { reqHeaders: member.reqHeaders },
    });

    const context = await handlers.session.getContext({
      context: { reqHeaders: member.reqHeaders },
    });
    expect(context.organization.activeOrganizationId).toBe(otherOrg.id);
    expect(context.organization.teams).toEqual([]);
    expect(context.organization.activeTeamId).toBeNull();
  });
});

describe("setActiveTeam", () => {
  it("rejects a team the user is not a member of", async () => {
    const { owner, org, handlers } = await orgWithTeamMember();
    const outsider = await createTestUser(services.services);
    await addTestMember(services.services, org.id, outsider.userId, "member");
    await handlers.organizations.setActiveOrganization({
      input: { organizationId: org.id },
      context: { reqHeaders: outsider.reqHeaders },
    });
    const finance = await handlers.teams.createTeam({
      input: { name: "Finance", organizationId: org.id, areas: ["finance"] },
      context: { reqHeaders: owner.reqHeaders },
    });

    await expect(
      handlers.teams.setActiveTeam({
        input: { teamId: finance.id },
        context: { reqHeaders: outsider.reqHeaders },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("unsets the active team when given null", async () => {
    const { member, team, handlers } = await orgWithTeamMember();
    await handlers.teams.setActiveTeam({
      input: { teamId: team.id },
      context: { reqHeaders: member.reqHeaders },
    });

    const result = await handlers.teams.setActiveTeam({
      input: { teamId: null },
      context: { reqHeaders: member.reqHeaders },
    });

    expect(result).toBeNull();
    const context = await handlers.session.getContext({
      context: { reqHeaders: member.reqHeaders },
    });
    expect(context.organization.activeTeamId).toBeNull();
    expect(context.organization.teams).toHaveLength(1);
  });

  it("requires authentication", async () => {
    const { team, handlers } = await orgWithTeamMember();

    await expect(
      handlers.teams.setActiveTeam({ input: { teamId: team.id }, context: {} }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("listUserTeams", () => {
  it("lists only the user's teams in the active organization", async () => {
    const { owner, member, org, team, handlers } = await orgWithTeamMember();
    await handlers.teams.createTeam({
      input: { name: "Finance", organizationId: org.id, areas: ["finance"] },
      context: { reqHeaders: owner.reqHeaders },
    });
    const otherOrg = await createTestOrg(services.services, owner.userId);
    await addTestMember(services.services, otherOrg.id, member.userId, "member");
    const otherTeam = await handlers.teams.createTeam({
      input: { name: "Elsewhere", organizationId: otherOrg.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    await handlers.teams.addTeamMember({
      input: { teamId: otherTeam.id, userId: member.userId, organizationId: otherOrg.id },
      context: { reqHeaders: owner.reqHeaders },
    });

    const teams = await handlers.teams.listUserTeams({
      input: undefined,
      context: { reqHeaders: member.reqHeaders },
    });

    expect(teams.map((t: { id: string }) => t.id)).toEqual([team.id]);
    expect(teams[0]).toMatchObject({ name: "Node Operator", areas: ["node-operations"] });
  });
});

describe("team area grants", () => {
  it("round-trips areas through create, update and list", async () => {
    const { owner, org, team, handlers } = await orgWithTeamMember(["things"]);

    const updated = await handlers.teams.updateTeam({
      input: { teamId: team.id, organizationId: org.id, data: { areas: ["stake", "finance"] } },
      context: { reqHeaders: owner.reqHeaders },
    });

    expect(updated).toMatchObject({ name: "Node Operator", areas: ["stake", "finance"] });
    const listed = await handlers.teams.listTeams({
      input: { organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    expect(listed).toEqual([expect.objectContaining({ id: team.id, areas: ["stake", "finance"] })]);
  });
});

describe("listTeamMembers", () => {
  it("lets organization members who are not in the team view its members", async () => {
    const { owner, member, org, team, handlers } = await orgWithTeamMember();
    const colleague = await createTestUser(services.services);
    await addTestMember(services.services, org.id, colleague.userId, "member");

    for (const viewer of [owner, colleague]) {
      const members = await handlers.teams.listTeamMembers({
        input: { teamId: team.id },
        context: { reqHeaders: viewer.reqHeaders },
      });
      expect(members.map((m: { userId: string }) => m.userId)).toEqual([member.userId]);
    }
  });

  it("rejects users outside the team's organization", async () => {
    const { team, handlers } = await orgWithTeamMember();
    const stranger = await createTestUser(services.services);

    await expect(
      handlers.teams.listTeamMembers({
        input: { teamId: team.id },
        context: { reqHeaders: stranger.reqHeaders },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
