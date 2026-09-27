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

describe("API Plugin Integration Tests", () => {
  describe("resolveTenant", () => {
    it("returns null for an unknown account", async () => {
      const client = await getPluginClient();
      const result = await client.resolveTenant({ accountId: "nobody.near" });
      expect(result).toBeNull();
    });

    it("resolves a tenant created by its owning organization", async () => {
      const client = await getPluginClient(
        daoContext("plugin-resolve-user-1", "plugin-resolve-org-1", "admin-resolve-1.near"),
      );

      const created = await client.createTenant({
        name: "Acme Corp",
        accountId: "acme.example.near",
        status: "active",
      });
      expect(created).toMatchObject({
        name: "Acme Corp",
        accountId: "acme.example.near",
        orgId: "plugin-resolve-org-1",
        status: "active",
      });

      const resolved = await client.resolveTenant({ accountId: "acme.example.near" });
      expect(resolved?.id).toBe(created.id);
    });

    it("rejects invalid accountId format on create", async () => {
      const client = await getPluginClient(
        daoContext(
          "plugin-resolve-user-invalid",
          "plugin-resolve-org-invalid",
          "admin-invalid.near",
        ),
      );
      await expect(
        client.createTenant({
          name: "Acme",
          accountId: "NOT-A-VALID-ACCOUNT",
        }),
      ).rejects.toThrow("Invalid accountId format");
    });
  });

  describe("nodes", () => {
    it("creates a root country node and lists root nodes", async () => {
      const client = await getPluginClient(
        daoContext("country-holder-1", "country-holder-org-1", "admin-country-1.near"),
      );

      const tenant = await client.createTenant({
        name: "Country Holder",
        accountId: "countryholder.example.near",
        status: "active",
      });

      const before = await client.listRootNodes();
      expect(before).toEqual([]);

      const created = await client.createNode({
        kind: "country",
        slug: "usa",
        name: "United States",
        parentId: null,
        tenantId: tenant.id,
        metadata: { population: 330_000_000 },
      });
      expect(created).toMatchObject({
        kind: "country",
        slug: "usa",
        name: "United States",
        parentId: null,
        tenantId: tenant.id,
        metadata: { population: 330_000_000 },
      });

      const after = await client.listRootNodes();
      expect(after.map((n) => n.slug)).toEqual(["usa"]);

      const fetched = await client.getNode({ nodeId: created.id });
      expect(fetched?.id).toBe(created.id);
    });

    it("filters nodes by tenant", async () => {
      const firstClient = await getPluginClient(
        daoContext(
          "tenant-filter-user-a",
          "tenant-filter-org-a",
          "admin-tenant-filter-a.near",
          "owner",
        ),
      );
      const secondClient = await getPluginClient(
        daoContext(
          "tenant-filter-user-b",
          "tenant-filter-org-b",
          "admin-tenant-filter-b.near",
          "owner",
        ),
      );
      const firstTenant = await firstClient.createTenant({
        name: "Tenant Filter A",
        accountId: "tenant-filter-a.example.near",
        status: "active",
      });
      const secondTenant = await secondClient.createTenant({
        name: "Tenant Filter B",
        accountId: "tenant-filter-b.example.near",
        status: "active",
      });
      const firstNode = await firstClient.createNode({
        kind: "city",
        slug: "tenant-filter-a",
        name: "Tenant Filter A",
        parentId: null,
        tenantId: firstTenant.id,
      });
      await secondClient.createNode({
        kind: "city",
        slug: "tenant-filter-b",
        name: "Tenant Filter B",
        parentId: null,
        tenantId: secondTenant.id,
      });

      const publicClient = await getPluginClient();
      const nodes = await publicClient.listNodes({ tenantId: firstTenant.id });

      expect(nodes).toEqual([firstNode]);
    });

    it("creates a nested node tree (country → state → city)", async () => {
      const client = await getPluginClient(
        daoContext("tree-holder-1", "tree-holder-org-1", "admin-tree-1.near"),
      );

      const tenant = await client.createTenant({
        name: "Tree Holder",
        accountId: "treeholder.example.near",
        status: "active",
      });

      const usa = await client.createNode({
        kind: "country",
        slug: "usa-tree",
        name: "USA",
        parentId: null,
        tenantId: tenant.id,
      });
      const illinois = await client.createNode({
        kind: "state",
        slug: "illinois",
        name: "Illinois",
        parentId: usa.id,
        tenantId: tenant.id,
      });
      const chicago = await client.createNode({
        kind: "city",
        slug: "chicago",
        name: "Chicago",
        parentId: illinois.id,
        tenantId: tenant.id,
      });

      const children = await client.listChildren({ nodeId: illinois.id });
      expect(children.map((c) => c.slug)).toEqual(["chicago"]);

      const resolved = await client.resolveNodeBySlug({ slug: "chicago", parentId: illinois.id });
      expect(resolved?.id).toBe(chicago.id);
    });

    it("returns a node subtree with validators through the public client", async () => {
      const client = await getPluginClient(
        daoContext("subtree-holder-1", "subtree-holder-org-1", "admin-subtree-1.near"),
      );

      const tenant = await client.createTenant({
        name: "Subtree Holder",
        accountId: "subtreeholder.example.near",
        status: "active",
      });
      const country = await client.createNode({
        kind: "country",
        slug: "subtree-country",
        name: "Subtree Country",
        parentId: null,
        tenantId: tenant.id,
      });
      const state = await client.createNode({
        kind: "state",
        slug: "subtree-state",
        name: "Subtree State",
        parentId: country.id,
        tenantId: tenant.id,
      });
      const city = await client.createNode({
        kind: "city",
        slug: "subtree-city",
        name: "Subtree City",
        parentId: state.id,
        tenantId: tenant.id,
      });

      await client.createValidator({
        nodeId: country.id,
        accountId: "subtree-official.near",
        role: "official",
        isDefault: true,
      });
      await client.createValidator({
        nodeId: city.id,
        accountId: "subtree-community.near",
        role: "community",
      });

      const publicClient = await getPluginClient();
      const subtree = await publicClient.getSubtree({ nodeId: country.id });
      const bySlug = Object.fromEntries(subtree.map((node) => [node.slug, node]));

      expect(Object.keys(bySlug).sort()).toEqual([
        "subtree-city",
        "subtree-country",
        "subtree-state",
      ]);
      expect(bySlug["subtree-country"]?.validators).toEqual([
        expect.objectContaining({
          accountId: "subtree-official.near",
          role: "official",
          isDefault: true,
        }),
      ]);
      expect(bySlug["subtree-state"]?.validators).toEqual([]);
      expect(bySlug["subtree-city"]?.validators).toEqual([
        expect.objectContaining({
          accountId: "subtree-community.near",
          role: "community",
          isDefault: false,
        }),
      ]);
    });

    it("returns an aggregated summary for a node", async () => {
      const client = await getPluginClient(
        daoContext("summary-holder-1", "summary-holder-org-1", "admin-summary-1.near"),
      );

      const tenant = await client.createTenant({
        name: "Summary Holder",
        accountId: "summaryholder.example.near",
        status: "active",
      });
      const country = await client.createNode({
        kind: "country",
        slug: "summary-country",
        name: "Summary Country",
        parentId: null,
        tenantId: tenant.id,
        metadata: { population: 1_000_000 },
      });
      const state = await client.createNode({
        kind: "state",
        slug: "summary-state",
        name: "Summary State",
        parentId: country.id,
        tenantId: tenant.id,
      });
      await client.createNode({
        kind: "city",
        slug: "summary-city",
        name: "Summary City",
        parentId: state.id,
        tenantId: tenant.id,
      });

      await client.createValidator({
        nodeId: country.id,
        accountId: "summary-official.near",
        role: "official",
        isDefault: true,
      });
      await client.createValidator({
        nodeId: state.id,
        accountId: "summary-community.near",
        role: "community",
      });

      const publicClient = await getPluginClient();
      const summary = await publicClient.getNodeSummary({ nodeId: country.id });

      expect(summary.node).toEqual(country);
      expect(summary.childrenCount).toBe(1);
      expect(summary.subtreeNodeCount).toBe(3);
      expect(summary.validators).toEqual([
        expect.objectContaining({
          nodeId: country.id,
          accountId: "summary-official.near",
          role: "official",
        }),
      ]);
      expect(summary.subtreeValidatorCount).toBe(2);
      expect(summary.subtreeValidatorCountsByRole).toEqual({ official: 1, community: 1 });
      expect(summary.stakingValidators.sourceNodeId).toBe(country.id);
      expect(
        summary.stakingValidators.validators.map((validator) => validator.accountId).sort(),
      ).toEqual(["summary-community.near", "summary-official.near"]);
      expect(summary.children).toEqual([
        {
          id: state.id,
          kind: "state",
          slug: "summary-state",
          name: "Summary State",
        },
      ]);
    });

    it("summarizes a leaf and resolves staking from its nearest ancestor", async () => {
      const client = await getPluginClient(
        daoContext("leaf-summary-1", "leaf-summary-org-1", "admin-leaf-summary-1.near"),
      );

      const tenant = await client.createTenant({
        name: "Leaf Summary Holder",
        accountId: "leafsummaryholder.example.near",
        status: "active",
      });
      const country = await client.createNode({
        kind: "country",
        slug: "leaf-summary-country",
        name: "Leaf Summary Country",
        parentId: null,
        tenantId: tenant.id,
      });
      const state = await client.createNode({
        kind: "state",
        slug: "leaf-summary-state",
        name: "Leaf Summary State",
        parentId: country.id,
        tenantId: tenant.id,
      });
      const city = await client.createNode({
        kind: "city",
        slug: "leaf-summary-city",
        name: "Leaf Summary City",
        parentId: state.id,
        tenantId: tenant.id,
      });

      await client.createValidator({
        nodeId: state.id,
        accountId: "leaf-summary-validator.near",
        role: "official",
        isDefault: true,
      });

      const summary = await client.getNodeSummary({ nodeId: city.id });

      expect(summary.childrenCount).toBe(0);
      expect(summary.subtreeNodeCount).toBe(1);
      expect(summary.validators).toEqual([]);
      expect(summary.subtreeValidatorCount).toBe(0);
      expect(summary.subtreeValidatorCountsByRole).toEqual({ official: 0, community: 0 });
      expect(summary.children).toEqual([]);
      expect(summary.stakingValidators.sourceNodeId).toBe(state.id);
      expect(summary.stakingValidators.validators).toEqual([
        expect.objectContaining({ accountId: "leaf-summary-validator.near" }),
      ]);
    });

    it("rejects aggregation requests for an unknown node", async () => {
      const client = await getPluginClient();
      const nodeId = "00000000-0000-0000-0000-000000000000";

      await expect(client.getSubtree({ nodeId })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Node not found",
      });
      await expect(client.getNodeSummary({ nodeId })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Node not found",
      });
    });
  });

  describe("bindingPreflight", () => {
    it("reports availability for a fresh hostname", async () => {
      const client = await getPluginClient(authedContext());
      const result = await client.bindingPreflight({ hostname: "fresh.example.com" });

      expect(result.hostname.available).toBe(true);
      expect(result.hostname.format).toBe("valid");
    });

    it("flags invalid hostname format", async () => {
      const client = await getPluginClient(authedContext());
      const result = await client.bindingPreflight({ hostname: "INVALID HOSTNAME!" });

      expect(result.hostname.format).toBe("invalid");
      expect(result.hostname.available).toBe(false);
    });
  });

  describe("validators", () => {
    it("creates a validator and resolves it for staking from descendants", async () => {
      const client = await getPluginClient(
        daoContext("validator-holder-1", "validator-holder-org-1", "admin-validator-1.near"),
      );

      const tenant = await client.createTenant({
        name: "Validator Holder",
        accountId: "validatorholder.example.near",
        status: "active",
      });

      const country = await client.createNode({
        kind: "country",
        slug: "validatorland",
        name: "Validatorland",
        parentId: null,
        tenantId: tenant.id,
      });
      const state = await client.createNode({
        kind: "state",
        slug: "val-state",
        name: "Validator State",
        parentId: country.id,
        tenantId: tenant.id,
      });

      const validator = await client.createValidator({
        nodeId: country.id,
        accountId: "val1.near",
        role: "official",
        isDefault: true,
      });
      expect(validator).toMatchObject({
        nodeId: country.id,
        accountId: "val1.near",
        role: "official",
        isDefault: true,
      });

      const resolved = await client.resolveStakingValidators({ nodeId: state.id });
      expect(resolved.sourceNodeId).toBe(country.id);
      expect(resolved.validators.map((v) => v.accountId)).toEqual(["val1.near"]);

      const fetched = await client.getValidator({ validatorId: validator.id });
      expect(fetched?.id).toBe(validator.id);
    });

    it("rejects validator mutations from outside the node's organization", async () => {
      const owner = await getPluginClient(
        daoContext("validator-scope-owner", "validator-scope-org", "admin-validator-scope.near"),
      );
      const outsider = await getPluginClient(
        orgContext("validator-outsider", "validator-outsider-org"),
      );

      const tenant = await owner.createTenant({
        name: "Validator Scope",
        accountId: "validatorscope.example.near",
        status: "active",
      });
      const node = await owner.createNode({
        kind: "country",
        slug: "validator-scope",
        name: "Validator Scope",
        parentId: null,
        tenantId: tenant.id,
      });
      const validator = await owner.createValidator({
        nodeId: node.id,
        accountId: "scoped.near",
        role: "official",
      });

      await expect(
        outsider.createValidator({ nodeId: node.id, accountId: "intruder.near" }),
      ).rejects.toThrow("This node's validators do not belong to your organization");
      await expect(
        outsider.updateValidator({ validatorId: validator.id, role: "community" }),
      ).rejects.toThrow("This node's validators do not belong to your organization");
      await expect(outsider.deleteValidator({ validatorId: validator.id })).rejects.toThrow(
        "This node's validators do not belong to your organization",
      );
      await expect(outsider.setDefaultValidator({ validatorId: validator.id })).rejects.toThrow(
        "This node's validators do not belong to your organization",
      );
    });
  });
});
