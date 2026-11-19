import { describe, expect, it, vi } from "vitest";
import type { AuthApiClient } from "@/lib/api";
import { createAdminAdapter, createMemberAdapter, OrganizationNotFoundError } from "./adapter";

const org = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
  logo: null,
  metadata: null,
  status: "active" as const,
  createdAt: new Date("2026-01-01"),
};

function member(userId: string, role: string) {
  return {
    id: `member-${userId}`,
    userId,
    organizationId: org.id,
    role,
    createdAt: new Date("2026-01-02"),
    user: { id: userId, name: userId, email: `${userId}@example.com`, image: null },
  };
}

function api(overrides: Record<string, unknown>) {
  return overrides as unknown as AuthApiClient;
}

describe("member adapter", () => {
  it("resolves the organization by slug and reports a missing one", async () => {
    const adapter = createMemberAdapter(
      api({ listOrganizations: vi.fn().mockResolvedValue([org]) }),
    );
    await expect(adapter.loadSnapshot("ghost", "user-1")).rejects.toBeInstanceOf(
      OrganizationNotFoundError,
    );
  });

  it("loads invitations only for owners and admins", async () => {
    const listInvitations = vi.fn().mockResolvedValue([]);
    const base = {
      listOrganizations: vi.fn().mockResolvedValue([org]),
      listMembers: vi.fn().mockResolvedValue({
        members: [member("owner-1", "owner"), member("plain-1", "member")],
        total: 2,
      }),
      listTeams: vi.fn().mockResolvedValue([]),
      listInvitations,
    };
    const adapter = createMemberAdapter(api(base));

    const asMember = await adapter.loadSnapshot("acme", "plain-1");
    expect(asMember.myRole).toBe("member");
    expect(listInvitations).not.toHaveBeenCalled();

    const asOwner = await adapter.loadSnapshot("acme", "owner-1");
    expect(asOwner.myRole).toBe("owner");
    expect(listInvitations).toHaveBeenCalledWith({ organizationId: org.id });
  });

  it("removes a member by email, falling back to the user id", async () => {
    const removeMember = vi.fn().mockResolvedValue({ success: true });
    const adapter = createMemberAdapter(api({ removeMember }));

    await adapter.removeMember({ orgId: org.id, member: member("u1", "member") });
    await adapter.removeMember({
      orgId: org.id,
      member: { ...member("u2", "member"), user: null },
    });

    expect(removeMember).toHaveBeenNthCalledWith(1, {
      memberIdOrEmail: "u1@example.com",
      organizationId: org.id,
    });
    expect(removeMember).toHaveBeenNthCalledWith(2, {
      memberIdOrEmail: "u2",
      organizationId: org.id,
    });
  });
});

describe("admin adapter", () => {
  it("splits the full organization into a snapshot with no viewer role", async () => {
    const adapter = createAdminAdapter(
      api({
        adminGetOrganizationFull: vi.fn().mockResolvedValue({
          ...org,
          members: [member("u1", "owner")],
          invitations: [],
          teams: [],
        }),
      }),
    );

    const snapshot = await adapter.loadSnapshot(org.id, undefined);

    expect(snapshot.org).toMatchObject({ id: org.id, slug: "acme" });
    expect(snapshot.org).not.toHaveProperty("members");
    expect(snapshot.members).toHaveLength(1);
    expect(snapshot.myRole).toBeNull();
  });

  it("maps a missing organization to the not-found error", async () => {
    const adapter = createAdminAdapter(
      api({
        adminGetOrganizationFull: vi.fn().mockRejectedValue(new Error("Organization not found")),
      }),
    );
    await expect(adapter.loadSnapshot("nope", undefined)).rejects.toBeInstanceOf(
      OrganizationNotFoundError,
    );
  });

  it("stores team areas in metadata and leaves metadata alone on a rename", async () => {
    const adminCreateTeam = vi.fn().mockResolvedValue({ id: "t1", name: "Finance" });
    const adminUpdateTeam = vi.fn().mockResolvedValue({});
    const adapter = createAdminAdapter(api({ adminCreateTeam, adminUpdateTeam }));

    await adapter.createTeam({ orgId: org.id, name: "Finance", areas: ["finance"] });
    await adapter.updateTeam({ orgId: org.id, teamId: "t1", name: "Money" });
    await adapter.updateTeam({ orgId: org.id, teamId: "t1", areas: ["finance", "events"] });

    expect(adminCreateTeam).toHaveBeenCalledWith({
      organizationId: org.id,
      name: "Finance",
      metadata: { areas: ["finance"] },
    });
    expect(adminUpdateTeam).toHaveBeenNthCalledWith(1, { teamId: "t1", data: { name: "Money" } });
    expect(adminUpdateTeam).toHaveBeenNthCalledWith(2, {
      teamId: "t1",
      data: { metadata: { areas: ["finance", "events"] } },
    });
  });

  it("does not advertise capabilities the admin console cannot serve", () => {
    const { capabilities } = createAdminAdapter(api({}));
    expect(capabilities).toMatchObject({
      invite: false,
      apiKeys: false,
      leave: false,
      switchActive: false,
      addMember: true,
      setStatus: true,
    });
  });
});
