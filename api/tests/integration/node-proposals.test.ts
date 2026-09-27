import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyDaoMembership } from "@/services/dao";
import { authedContext, getPluginClient, teardown } from "../setup";

vi.mock("@/services/dao", () => ({
  verifyDaoMembership: vi.fn(() =>
    Effect.succeed({ isSputnikContract: true, isMember: true, policy: { roles: [] } }),
  ),
  parsePolicyGroupMembers: vi.fn(() => []),
  isExplicitDaoMember: vi.fn(() => true),
}));

const adminContext = {
  ...authedContext("node-proposal-admin", "admin"),
  near: { primaryAccountId: "node-proposal-admin.near" },
};

describe("node proposal application", () => {
  beforeAll(async () => {
    await getPluginClient();
  }, 30_000);

  afterAll(async () => {
    await teardown();
  });

  it("atomically provisions the tenant, node, and primary binding", async () => {
    const admin = await getPluginClient(adminContext);

    const result = await admin.applyNodeProposal({
      kind: "country",
      name: "Proposal Country",
      slug: "proposal-country",
      parentId: null,
      orgId: "proposal-org",
      motivation: "I want to operate the country node for my community.",
      accountId: "proposal-city.sputnik-dao.near",
      submitterAccountId: "proposal-applicant.near",
      hostname: "proposal-country.citynode.app",
    });

    const node = await admin.getNode({ nodeId: result.nodeId });
    expect(node).toMatchObject({
      kind: "country",
      name: "Proposal Country",
      slug: "proposal-country",
      parentId: null,
    });

    const tenants = await admin.listTenants();
    const tenant = tenants.find((candidate) => candidate.id === node?.tenantId);
    expect(tenant).toMatchObject({
      name: "Proposal Country",
      accountId: "proposal-city.sputnik-dao.near",
      orgId: "proposal-org",
      status: "active",
      ownerKind: "dao",
    });
    expect(verifyDaoMembership).toHaveBeenCalledWith({
      daoAccountId: "proposal-city.sputnik-dao.near",
      memberAccountId: "proposal-applicant.near",
    });

    const bindings = await admin.listTenantBindingsForTenant({ tenantId: tenant?.id ?? "" });
    expect(bindings).toEqual([
      expect.objectContaining({
        hostname: "proposal-country.citynode.app",
        isPrimary: true,
      }),
    ]);
  });

  it("rejects non-admin callers", async () => {
    const member = await getPluginClient(authedContext("node-proposal-member"));

    await expect(
      member.applyNodeProposal({
        kind: "country",
        name: "Unauthorized Country",
        slug: "unauthorized-country",
        parentId: null,
        orgId: "unauthorized-org",
        motivation: "This should not be applied by a member.",
        accountId: "unauthorized-applicant.near",
        submitterAccountId: "unauthorized-applicant.near",
        hostname: "unauthorized-country.citynode.app",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects proposals whose applicant is not a member of the tenant DAO", async () => {
    (verifyDaoMembership as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      Effect.succeed({
        isSputnikContract: true,
        isMember: false,
        policy: { roles: [] },
      }),
    );
    const admin = await getPluginClient(adminContext);

    await expect(
      admin.applyNodeProposal({
        kind: "country",
        name: "Unowned Proposal Country",
        slug: "unowned-proposal-country",
        parentId: null,
        orgId: "unowned-proposal-org",
        motivation: "This applicant does not belong to the proposed tenant DAO.",
        accountId: "unowned-proposal.sputnik-dao.near",
        submitterAccountId: "outsider.near",
        hostname: "unowned-proposal-country.citynode.app",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const tenants = await admin.listTenants();
    expect(tenants.some((tenant) => tenant.accountId === "unowned-proposal.sputnik-dao.near")).toBe(
      false,
    );
  });

  it("validates account IDs and parent hierarchy", async () => {
    const admin = await getPluginClient(adminContext);

    await expect(
      admin.applyNodeProposal({
        kind: "country",
        name: "Invalid Account Country",
        slug: "invalid-account-country",
        parentId: null,
        orgId: "invalid-account-org",
        motivation: "Testing server-side account validation.",
        accountId: "INVALID ACCOUNT",
        submitterAccountId: "proposal-applicant.near",
        hostname: "invalid-account-country.citynode.app",
      }),
    ).rejects.toThrow("Invalid accountId format");

    await expect(
      admin.applyNodeProposal({
        kind: "state",
        name: "Missing Parent State",
        slug: "missing-parent-state",
        parentId: null,
        orgId: "missing-parent-org",
        motivation: "Testing server-side parent validation.",
        accountId: "missing-parent.near",
        submitterAccountId: "missing-parent.near",
        hostname: "missing-parent-state.citynode.app",
      }),
    ).rejects.toBeTruthy();
  });

  it("does not leave a tenant behind when proposal resources conflict", async () => {
    const admin = await getPluginClient(adminContext);
    await admin.applyNodeProposal({
      kind: "country",
      name: "Existing Proposal Country",
      slug: "existing-proposal-country",
      parentId: null,
      orgId: "existing-proposal-org",
      motivation: "Create the resource used for the conflict case.",
      accountId: "existing-proposal.near",
      submitterAccountId: "existing-proposal.near",
      hostname: "existing-proposal-country.citynode.app",
    });

    await expect(
      admin.applyNodeProposal({
        kind: "country",
        name: "Conflicting Proposal Country",
        slug: "conflicting-proposal-country",
        parentId: null,
        orgId: "conflicting-proposal-org",
        motivation: "This proposal deliberately conflicts on hostname.",
        accountId: "conflicting-proposal.near",
        submitterAccountId: "conflicting-proposal.near",
        hostname: "existing-proposal-country.citynode.app",
      }),
    ).rejects.toThrow("Hostname already in use");

    const tenants = await admin.listTenants();
    expect(tenants.some((tenant) => tenant.accountId === "conflicting-proposal.near")).toBe(false);
    expect(await admin.resolveNodeBySlug({ slug: "conflicting-proposal-country" })).toBeNull();
  });
});
