import { call, os } from "@orpc/server";
import { describe, expect, it } from "vitest";
import type { AuthPluginContext as AuthContext } from "../../src/lib/auth-types.gen";
import { createRequireTeamArea, resolveTeamAccess } from "../../src/team-access-policy";

describe("team access policy", () => {
  it.each([
    null,
    "stale-team",
  ])("does not restrict an unresolved active team: %s", (activeTeamId) => {
    const finance = { id: "finance", name: "Finance", areas: ["finance"] };
    expect(resolveTeamAccess({ organization: { teams: [finance], activeTeamId } })).toEqual({
      teams: [finance],
      activeTeam: null,
      bypass: false,
      allowedAreas: null,
    });
  });

  it("treats missing organization context as unrestricted without an active team", () => {
    expect(resolveTeamAccess(null)).toEqual({
      teams: [],
      activeTeam: null,
      bypass: false,
      allowedAreas: null,
    });
  });

  it.each([
    { userRole: "user", orgRole: "owner" },
    { userRole: "user", orgRole: "admin" },
    { userRole: "admin", orgRole: "member" },
  ])("leaves $userRole / $orgRole unrestricted", ({ userRole, orgRole }) => {
    const finance = { id: "finance", name: "Finance", areas: ["finance"] };
    expect(
      resolveTeamAccess({
        user: { role: userRole },
        organization: {
          member: { role: orgRole },
          teams: [finance],
          activeTeamId: finance.id,
        },
      }),
    ).toEqual({ teams: [finance], activeTeam: finance, bypass: true, allowedAreas: null });
  });

  it("grants a member only recognized areas of their selected team", () => {
    const finance = { id: "finance", name: "Finance", areas: ["finance", "unknown-area"] };

    expect(
      resolveTeamAccess({
        user: { role: "user" },
        organization: {
          member: { role: "member" },
          teams: [finance],
          activeTeamId: "finance",
        },
      }),
    ).toEqual({ teams: [finance], activeTeam: finance, bypass: false, allowedAreas: ["finance"] });
  });
});

describe("createRequireTeamArea", () => {
  const builder = os.$context<AuthContext>();
  const requireNodeOperations = createRequireTeamArea(builder)("node-operations");
  const whoAmI = builder
    .use(requireNodeOperations)
    .handler(({ context }) => context.activeTeam?.id ?? null);

  function member(
    orgRole: string,
    organization: {
      teams?: Array<{ id: string; name: string; areas: string[] }>;
      activeTeamId?: string | null;
    },
    userRole?: string,
  ): AuthContext {
    return {
      userId: "u1",
      user: {
        id: "u1",
        name: "U",
        email: "u1@example.com",
        emailVerified: true,
        image: null,
        role: userRole ?? null,
        isAnonymous: false,
      },
      organization: {
        activeOrganizationId: "org-1",
        organization: { id: "org-1", name: "Org", slug: "org" },
        member: { id: "m1", role: orgRole },
        isPersonal: false,
        hasOrganization: true,
        teams: organization.teams ?? [],
        activeTeamId: organization.activeTeamId ?? null,
      },
    };
  }

  const ops = { id: "team-ops", name: "Node Operator", areas: ["node-operations"] };
  const finance = { id: "team-finance", name: "Finance", areas: ["finance"] };

  it("allows a member whose active team is granted the area", async () => {
    await expect(
      call(whoAmI, undefined, {
        context: member("member", { teams: [ops], activeTeamId: ops.id }),
      }),
    ).resolves.toBe("team-ops");
  });

  it("rejects a member whose active team lacks the area", async () => {
    await expect(
      call(whoAmI, undefined, {
        context: member("member", { teams: [finance], activeTeamId: finance.id }),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("Finance") });
  });

  it("lets a member with no active team through unrestricted", async () => {
    await expect(
      call(whoAmI, undefined, { context: member("member", { teams: [finance] }) }),
    ).resolves.toBeNull();
  });

  it("lets organization owners, admins and platform admins through regardless of area", async () => {
    await expect(
      call(whoAmI, undefined, {
        context: member("owner", { teams: [finance], activeTeamId: finance.id }),
      }),
    ).resolves.toBe("team-finance");
    await expect(
      call(whoAmI, undefined, {
        context: member("member", { teams: [finance], activeTeamId: finance.id }, "admin"),
      }),
    ).resolves.toBe("team-finance");
  });
});
