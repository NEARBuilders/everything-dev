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

const adminContext = {
  ...authedContext("platform-admin"),
  user: { id: "platform-admin", email: "admin@example.com", name: "Admin", role: "admin" },
  near: { primaryAccountId: "platform-admin.near" },
};

describe("platform node management", () => {
  it("lets platform admins list and manage another organization's node without switching orgs", async () => {
    const owner = await getPluginClient(
      daoContext("owner", "managed-org", "admin-owner-managed.near"),
    );
    const admin = await getPluginClient(adminContext);
    const outsider = await getPluginClient(orgContext("outsider", "other-org"));
    const tenant = await owner.createTenant({ name: "Chicago", accountId: "managed-chicago.near" });
    const node = await owner.createNode({
      name: "Chicago",
      kind: "country",
      slug: "managed-chicago",
      tenantId: tenant.id,
    });

    expect(await admin.listTenants()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tenant.id })]),
    );
    expect(await outsider.listTenants()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tenant.id })]),
    );
    const publicClient = await getPluginClient();
    await expect(publicClient.listTenants()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await (await getPluginClient(authedContext())).listTenants()).toEqual([]);

    await expect(outsider.updateNode({ nodeId: node.id, name: "Changed" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      (await getPluginClient(authedContext())).updateNode({ nodeId: node.id, name: "Changed" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const updated = await admin.updateNode({
      nodeId: node.id,
      name: "Chicago City",
      metadata: { description: "Community node", population: 2700000 },
    });
    expect(updated).toMatchObject({
      name: "Chicago City",
      metadata: { description: "Community node", population: 2700000 },
    });

    const validator = await admin.createValidator({
      nodeId: node.id,
      accountId: "everything.pool.near",
      network: "mainnet",
      protocol: "near",
      role: "community",
    });
    await admin.setDefaultValidator({ validatorId: validator.id });
    expect((await admin.getNodeSummary({ nodeId: node.id })).validators).toMatchObject([
      { id: validator.id, role: "community", isDefault: true },
    ]);
    await admin.deleteValidator({ validatorId: validator.id });
    expect((await admin.getNodeSummary({ nodeId: node.id })).validators).toEqual([]);

    const binding = await admin.createBinding({ tenantId: tenant.id, hostname: "managed-chicago" });
    expect(binding.isVerified).toBe(true);
    await expect(
      outsider.deleteBinding({ tenantId: tenant.id, bindingId: binding.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      publicClient.deleteBinding({ tenantId: tenant.id, bindingId: binding.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await admin.deleteBinding({ tenantId: tenant.id, bindingId: binding.id });
    expect(await admin.listTenantBindingsForTenant({ tenantId: tenant.id })).toEqual([]);
  });

  it("rejects verification and removal when a binding belongs to a different tenant", async () => {
    const owner = await getPluginClient(
      daoContext("binding-owner", "binding-org", "admin-binding-owner.near"),
    );
    const admin = await getPluginClient(adminContext);
    const first = await owner.createTenant({ name: "First", accountId: "binding-first.near" });
    const second = await owner.createTenant({ name: "Second", accountId: "binding-second.near" });
    const binding = await owner.createBinding({
      tenantId: first.id,
      hostname: "managed.example.com",
    });

    for (const client of [owner, admin]) {
      await expect(
        client.verifyCustomDomain({ tenantId: second.id, bindingId: binding.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        client.deleteBinding({ tenantId: second.id, bindingId: binding.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await owner.listTenantBindingsForTenant({ tenantId: first.id })).toMatchObject([
      { id: binding.id, isVerified: false },
    ]);
    await owner.deleteBinding({ tenantId: first.id, bindingId: binding.id });
  });
});
