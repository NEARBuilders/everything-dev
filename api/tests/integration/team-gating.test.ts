import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { authedContext, daoContext, getPluginClient, orgContext } from "../setup";

vi.mock("@/services/dao", () => ({
  verifyDaoMembership: vi.fn(() =>
    Effect.succeed({ isSputnikContract: true, isMember: true, policy: { roles: [] } }),
  ),
  parsePolicyGroupMembers: vi.fn(() => []),
  isExplicitDaoMember: vi.fn(() => true),
}));

const ORG = "team-gating-org";

function teamContext(
  userId: string,
  options: {
    orgRole?: "owner" | "admin" | "member";
    userRole?: string;
    areas?: string[];
    active?: boolean;
  } = {},
) {
  const base = orgContext(userId, ORG, options.orgRole ?? "member", options.userRole);
  const team = { id: `team-${userId}`, name: "Finance", areas: options.areas ?? ["finance"] };
  return {
    ...base,
    organization: {
      ...(base.organization as Record<string, unknown>),
      teams: [team],
      activeTeamId: options.active === false ? null : team.id,
    },
  };
}

async function seedNode() {
  const owner = await getPluginClient(daoContext("gating-owner", ORG, "admin-gating-owner.near"));
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await owner.createTenant({
    name: "Gating",
    accountId: `gating-${suffix}.near`,
  });
  return owner.createNode({
    name: "Gating",
    kind: "country",
    slug: `gating-${suffix}`,
    tenantId: tenant.id,
  });
}

describe("team area gating on node operations", () => {
  it("allows a team member whose active team is granted node-operations", async () => {
    const node = await seedNode();
    const client = await getPluginClient(teamContext("ops-member", { areas: ["node-operations"] }));

    await expect(client.updateNode({ nodeId: node.id, name: "Renamed" })).resolves.toMatchObject({
      name: "Renamed",
    });
  });

  it("rejects a team member whose active team lacks node-operations", async () => {
    const node = await seedNode();
    const client = await getPluginClient(teamContext("finance-member", { areas: ["finance"] }));

    await expect(client.updateNode({ nodeId: node.id, name: "Renamed" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      data: { requiredPermissions: ["node-operations"], action: "switch-team" },
    });
    await expect(
      client.createValidator({
        nodeId: node.id,
        accountId: "gated.pool.near",
        network: "mainnet",
        protocol: "near",
        role: "community",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets organization owners and admins bypass team restrictions", async () => {
    const node = await seedNode();
    const owner = await getPluginClient(teamContext("org-owner", { orgRole: "owner" }));
    const admin = await getPluginClient(teamContext("org-admin", { orgRole: "admin" }));

    await expect(owner.updateNode({ nodeId: node.id, name: "Owner" })).resolves.toMatchObject({
      name: "Owner",
    });
    await expect(admin.updateNode({ nodeId: node.id, name: "Admin" })).resolves.toMatchObject({
      name: "Admin",
    });
  });

  it("lets platform admins bypass team restrictions", async () => {
    const node = await seedNode();
    const client = await getPluginClient(teamContext("platform-admin", { userRole: "admin" }));

    await expect(client.updateNode({ nodeId: node.id, name: "Platform" })).resolves.toMatchObject({
      name: "Platform",
    });
  });

  it("keeps pre-teams access for members without an active team", async () => {
    const node = await seedNode();
    const client = await getPluginClient(teamContext("teamless-member", { active: false }));

    await expect(client.updateNode({ nodeId: node.id, name: "Teamless" })).resolves.toMatchObject({
      name: "Teamless",
    });
  });

  it("rejects users without an active organization", async () => {
    const node = await seedNode();
    const client = await getPluginClient(authedContext("orgless-user"));

    await expect(client.updateNode({ nodeId: node.id, name: "Nope" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("keeps public node reads open", async () => {
    const node = await seedNode();
    const client = await getPluginClient();

    await expect(client.getNode({ nodeId: node.id })).resolves.toMatchObject({ id: node.id });
  });
});

describe("team area gating on setNodeBulletin", () => {
  it("allows a team member whose active team is granted node-operations", async () => {
    const node = await seedNode();
    const client = await getPluginClient(teamContext("ops-member", { areas: ["node-operations"] }));

    await expect(
      client.setNodeBulletin({ nodeId: node.id, bulletin: "More features coming soon." }),
    ).resolves.toMatchObject({ metadata: { bulletin: "More features coming soon." } });
  });

  it("rejects a team member whose active team lacks node-operations", async () => {
    const node = await seedNode();
    const client = await getPluginClient(teamContext("finance-member", { areas: ["finance"] }));

    await expect(
      client.setNodeBulletin({ nodeId: node.id, bulletin: "Nope" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      data: { requiredPermissions: ["node-operations"], action: "switch-team" },
    });
  });

  it("rejects users without an active organization", async () => {
    const node = await seedNode();
    const client = await getPluginClient(authedContext("orgless-user"));

    await expect(
      client.setNodeBulletin({ nodeId: node.id, bulletin: "Nope" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("merges into metadata instead of replacing it, unlike updateNode", async () => {
    const node = await seedNode();
    const owner = await getPluginClient(teamContext("bulletin-owner", { orgRole: "owner" }));

    await owner.updateNode({ nodeId: node.id, metadata: { poolAccountId: "pool.poolv1.near" } });
    const withBulletin = await owner.setNodeBulletin({
      nodeId: node.id,
      bulletin: "More features coming soon.",
    });
    expect(withBulletin.metadata).toMatchObject({
      poolAccountId: "pool.poolv1.near",
      bulletin: "More features coming soon.",
    });

    const cleared = await owner.setNodeBulletin({ nodeId: node.id, bulletin: null });
    expect(cleared.metadata).toMatchObject({ poolAccountId: "pool.poolv1.near" });
    expect(cleared.metadata.bulletin).toBeUndefined();
  });
});
