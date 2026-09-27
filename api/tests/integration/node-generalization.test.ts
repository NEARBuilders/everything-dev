import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { daoContext, getPluginClient, orgContext, teardown } from "../setup";

vi.mock("@/services/dao", () => ({
  verifyDaoMembership: vi.fn(() =>
    Effect.succeed({ isSputnikContract: true, isMember: true, policy: { roles: [] } }),
  ),
  parsePolicyGroupMembers: vi.fn(() => []),
  isExplicitDaoMember: vi.fn(() => true),
}));

const ORG = "node-generalization-org";
const OTHER_ORG = "node-generalization-other-org";

function teamContext(userId: string, org: string, areas: string[]) {
  const base = orgContext(userId, org) as Record<string, unknown>;
  const team = { id: `team-${userId}`, name: "Node Ops", areas };
  return {
    ...base,
    organization: {
      ...(base.organization as Record<string, unknown>),
      teams: [team],
      activeTeamId: team.id,
    },
  };
}

describe("generalized node model", () => {
  beforeAll(async () => {
    await getPluginClient();
  }, 30_000);

  afterAll(async () => {
    await teardown();
  });

  it("spawns a standalone node without a tenant", async () => {
    const org = await getPluginClient(daoContext("spawn-owner", ORG, "spawn-owner.near"));
    const suffix = crypto.randomUUID().slice(0, 8);

    const node = await org.spawnNode({
      kind: "org",
      slug: `spawn-org-${suffix}`,
      name: "Spawned Org",
      parentId: null,
    });

    expect(node).toMatchObject({
      kind: "org",
      slug: `spawn-org-${suffix}`,
      name: "Spawned Org",
      parentId: null,
      tenantId: null,
    });

    const fetched = await org.getNode({ nodeId: node.id });
    expect(fetched).toMatchObject({ kind: "org", tenantId: null });
  });

  it("spawns a node attached to an org-owned tenant", async () => {
    const org = await getPluginClient(daoContext("spawn-tenant-owner", ORG, "spawn-tenant.near"));
    const suffix = crypto.randomUUID().slice(0, 8);

    const tenant = await org.createTenant({
      name: "Spawn Tenant",
      accountId: `spawn-tenant-${suffix}.near`,
    });
    const node = await org.spawnNode({
      kind: "community",
      slug: `spawn-community-${suffix}`,
      name: "Spawned Community",
      parentId: null,
      tenantId: tenant.id,
    });

    expect(node).toMatchObject({ kind: "community", tenantId: tenant.id });
  });

  it("rejects spawning into a tenant owned by another organization", async () => {
    const owner = await getPluginClient(daoContext("spawn-other-owner", ORG, "spawn-other.near"));
    const outsider = await getPluginClient(
      daoContext("spawn-outsider", OTHER_ORG, "spawn-outsider.near"),
    );
    const suffix = crypto.randomUUID().slice(0, 8);

    const tenant = await owner.createTenant({
      name: "Other Org Tenant",
      accountId: `spawn-other-${suffix}.near`,
    });

    await expect(
      outsider.spawnNode({
        kind: "community",
        slug: `spawn-hostile-${suffix}`,
        name: "Hostile Spawn",
        parentId: null,
        tenantId: tenant.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects standalone spawns from non-admin org members", async () => {
    const member = await getPluginClient(teamContext("spawn-member", ORG, ["node-operations"]));
    await expect(
      member.spawnNode({
        kind: "org",
        slug: `spawn-member-standalone-${crypto.randomUUID().slice(0, 8)}`,
        name: "Member Standalone Spawn",
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects grafting a child under another organization's node", async () => {
    const owner = await getPluginClient(daoContext("spawn-graft-owner", ORG, "spawn-graft.near"));
    const outsider = await getPluginClient(
      teamContext("spawn-graft-outsider", OTHER_ORG, ["node-operations"]),
    );
    const suffix = crypto.randomUUID().slice(0, 8);

    const tenant = await owner.createTenant({
      name: "Graft Tenant",
      accountId: `spawn-graft-${suffix}.near`,
    });
    const parent = await owner.spawnNode({
      kind: "org",
      slug: `spawn-graft-parent-${suffix}`,
      name: "Graft Parent",
      parentId: null,
      tenantId: tenant.id,
    });

    await expect(
      outsider.spawnNode({
        kind: "user",
        slug: `spawn-graft-child-${suffix}`,
        name: "Graft Child",
        parentId: parent.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects unauthenticated spawnNode calls", async () => {
    const anonymous = await getPluginClient();
    await expect(
      anonymous.spawnNode({
        kind: "org",
        slug: `spawn-anon-${crypto.randomUUID().slice(0, 8)}`,
        name: "Anonymous Spawn",
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("spawns child nodes under non-geo parents without kind restrictions", async () => {
    const org = await getPluginClient(daoContext("spawn-tree-owner", ORG, "spawn-tree.near"));
    const suffix = crypto.randomUUID().slice(0, 8);

    const parent = await org.spawnNode({
      kind: "zone",
      slug: `spawn-zone-${suffix}`,
      name: "Spawned Zone",
      parentId: null,
    });
    const child = await org.spawnNode({
      kind: "user",
      slug: `spawn-user-${suffix}`,
      name: "Spawned User",
      parentId: parent.id,
    });

    expect(child).toMatchObject({ kind: "user", parentId: parent.id });

    const children = await org.listChildren({ nodeId: parent.id });
    expect(children.map((entry) => entry.slug)).toContain(`spawn-user-${suffix}`);
  });

  it("rejects spawnNode with a missing parent or tenant", async () => {
    const org = await getPluginClient(daoContext("spawn-missing-owner", ORG, "spawn-missing.near"));
    const missingId = "00000000-0000-0000-0000-000000000000";

    await expect(
      org.spawnNode({
        kind: "org",
        slug: `spawn-orphan-${crypto.randomUUID().slice(0, 8)}`,
        name: "Orphan Spawn",
        parentId: missingId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      org.spawnNode({
        kind: "org",
        slug: `spawn-ghost-tenant-${crypto.randomUUID().slice(0, 8)}`,
        name: "Ghost Tenant Spawn",
        parentId: null,
        tenantId: missingId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("resolves staking validators through a non-geo subtree", async () => {
    const admin = await getPluginClient(
      daoContext("spawn-staking-owner", ORG, "spawn-staking.near"),
    );
    const suffix = crypto.randomUUID().slice(0, 8);

    const root = await admin.spawnNode({
      kind: "zone",
      slug: `staking-zone-${suffix}`,
      name: "Staking Zone",
      parentId: null,
    });
    const child = await admin.spawnNode({
      kind: "user",
      slug: `staking-user-${suffix}`,
      name: "Staking User",
      parentId: root.id,
    });
    await admin.createValidator({
      nodeId: child.id,
      accountId: `staking-pool-${suffix}.near`,
      network: "mainnet",
      protocol: "near",
      role: "official",
    });

    const fromChild = await admin.resolveStakingValidators({ nodeId: child.id });
    expect(fromChild.sourceNodeId).toBe(child.id);
    expect(fromChild.validators).toHaveLength(1);

    const fromRoot = await admin.resolveStakingValidators({ nodeId: root.id });
    expect(fromRoot.sourceNodeId).toBe(child.id);
    expect(fromRoot.validators).toHaveLength(1);
  });

  it("includes tenant-attached non-geo nodes in listTenantApps", async () => {
    const org = await getPluginClient(daoContext("spawn-apps-owner", ORG, "spawn-apps.near"));
    const suffix = crypto.randomUUID().slice(0, 8);

    const tenant = await org.createTenant({
      name: "Apps Tenant",
      accountId: `spawn-apps-${suffix}.near`,
    });
    await org.spawnNode({
      kind: "community",
      slug: `spawn-apps-node-${suffix}`,
      name: "Apps Community",
      parentId: null,
      tenantId: tenant.id,
    });

    const apps = await org.listTenantApps();
    const app = apps.find((entry) => entry.accountId === `spawn-apps-${suffix}.near`);
    expect(app?.node).toMatchObject({ kind: "community", name: "Apps Community" });
  });
});
