import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/app";
import type { AuthRequestContext } from "@/lib/auth";
import {
  areaForPath,
  isPathAllowed,
  resolveTeamWorkspace,
  teamWorkspaceQueryOptions,
} from "./team-workspace";

const finance = { id: "team-fin", name: "Finance", areas: ["finance", "stake"] };
const ops = { id: "team-ops", name: "Node Operator", areas: ["node-operations"] };

function context(options: { orgRole?: string; userRole?: string; activeTeamId?: string | null }) {
  return {
    user: { role: options.userRole ?? null },
    organization: {
      activeOrganizationId: "org-1",
      member: { id: "m1", role: options.orgRole ?? "member" },
      teams: [finance, ops],
      activeTeamId: options.activeTeamId ?? null,
    },
  } as AuthRequestContext;
}

describe("resolveTeamWorkspace", () => {
  it("drops an active team that is no longer in the member's organization teams", () => {
    const workspace = resolveTeamWorkspace(context({ activeTeamId: "removed-team" }));

    expect(workspace.activeTeam).toBeNull();
    expect(isPathAllowed(workspace, "/things")).toBe(true);
  });

  it("restricts a member to the active team's areas", () => {
    const workspace = resolveTeamWorkspace(context({ activeTeamId: "team-fin" }));

    expect(workspace.activeTeam?.name).toBe("Finance");
    expect(workspace.allowedAreas).toEqual(["finance", "stake"]);
  });

  it("leaves members without an active team unrestricted", () => {
    const workspace = resolveTeamWorkspace(context({}));

    expect(workspace.activeTeam).toBeNull();
    expect(workspace.allowedAreas).toBeNull();
    expect(workspace.teams).toHaveLength(2);
  });

  it("never restricts organization owners, admins or platform admins", () => {
    for (const ctx of [
      context({ orgRole: "owner", activeTeamId: "team-fin" }),
      context({ orgRole: "admin", activeTeamId: "team-fin" }),
      context({ userRole: "admin", activeTeamId: "team-fin" }),
    ]) {
      const workspace = resolveTeamWorkspace(ctx);
      expect(workspace.activeTeam?.id).toBe("team-fin");
      expect(workspace.allowedAreas).toBeNull();
    }
  });

  it("treats a missing context as unrestricted with no teams", () => {
    expect(resolveTeamWorkspace(null)).toEqual({
      teams: [],
      activeTeam: null,
      allowedAreas: null,
      canManageOrganization: false,
    });
  });

  it("lets organization owners and admins manage the organization", () => {
    expect(resolveTeamWorkspace(context({ orgRole: "owner" })).canManageOrganization).toBe(true);
    expect(resolveTeamWorkspace(context({ orgRole: "admin" })).canManageOrganization).toBe(true);
    expect(resolveTeamWorkspace(context({})).canManageOrganization).toBe(false);
  });
});

describe("route areas", () => {
  it("maps dashboard sections to feature areas", () => {
    expect(areaForPath("/dashboard/node")).toBe("node-operations");
    expect(areaForPath("/dashboard/node/proposals")).toBe("node-operations");
    expect(areaForPath("/tenant/abc")).toBe("node-operations");
    expect(areaForPath("/things/new")).toBe("things");
    expect(areaForPath("/stake")).toBe("stake");
    expect(areaForPath("/dashboard")).toBeNull();
    expect(areaForPath("/orgs/acme")).toBeNull();
    expect(areaForPath("/stakeholders")).toBeNull();
  });

  it("blocks sections outside the active team's areas only", () => {
    const restricted = resolveTeamWorkspace(context({ activeTeamId: "team-fin" }));
    const open = resolveTeamWorkspace(context({}));

    expect(isPathAllowed(restricted, "/stake")).toBe(true);
    expect(isPathAllowed(restricted, "/things")).toBe(false);
    expect(isPathAllowed(restricted, "/dashboard/node")).toBe(false);
    expect(isPathAllowed(restricted, "/dashboard")).toBe(true);
    expect(isPathAllowed(open, "/things")).toBe(true);
  });
});

describe("teamWorkspaceQueryOptions", () => {
  it("loads the workspace from the auth context", async () => {
    const getContext = vi.fn().mockResolvedValue(context({ activeTeamId: "team-ops" }));
    const apiClient = { auth: { getContext } } as unknown as ApiClient;

    const workspace = await new QueryClient().fetchQuery(teamWorkspaceQueryOptions(apiClient));

    expect(workspace.activeTeam?.id).toBe("team-ops");
    expect(workspace.allowedAreas).toEqual(["node-operations"]);
  });
});
