import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/app";
import { approveAndApplyProposal } from "./-proposal-application";

function proposal(pluginId: string, payload: unknown = {}) {
  return {
    id: "proposal-id",
    pluginId,
    entityId: pluginId === "node" ? "chicago" : "thing-id",
    payload,
    reviewStatus: "pending" as const,
    applyStatus: "not_started" as const,
    operation: "create" as const,
    schemaVersion: "1",
    removeStatus: "not_started" as const,
    removeError: null,
    appliedResourceId: null,
    appliedAt: null,
    removedAt: null,
    applyError: null,
    rejectionReason: null,
    createdBy: "user-id",
    submissionCount: 1,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
  };
}

function client(initialProposal = proposal("node", nodePayload)) {
  const approved = {
    ...initialProposal,
    reviewStatus: "approved" as const,
    updatedAt: "2026-09-03T00:01:00.000Z",
  };
  const applied = { ...approved, applyStatus: "applied" as const };
  return {
    proposals: {
      approve: vi.fn().mockResolvedValue({ data: approved }),
      markApplied: vi.fn().mockResolvedValue({ data: applied }),
      markApplyFailed: vi.fn().mockResolvedValue({
        data: { ...approved, applyStatus: "failed", applyError: "creation failed" },
      }),
    },
    template: { createThing: vi.fn().mockResolvedValue({ thingId: "thing-id" }) },
    applyNodeProposal: vi.fn().mockResolvedValue({ nodeId: "node-id" }),
  };
}

const nodePayload = {
  kind: "city",
  parentId: "state-id",
  name: "Chicago",
  slug: "chicago",
  orgId: "org-id",
  motivation: "I want to operate a node for the local community.",
  accountId: "chicago.sputnik-dao.near",
  submitterAccountId: "applicant.near",
};

describe("proposal application dispatcher", () => {
  it("applies node proposals and finalizes them with the node ID", async () => {
    const api = client(proposal("node", nodePayload));
    const publishTenantConfig = vi.fn().mockResolvedValue(undefined);
    const result = await approveAndApplyProposal({
      apiClient: api as unknown as ApiClient,
      proposal: proposal("node", nodePayload),
      gatewayId: "citynode.app",
      baseAccount: "everything.near",
      publishTenantConfig,
    });

    expect(api.applyNodeProposal).toHaveBeenCalledWith({
      ...nodePayload,
      hostname: "chicago.citynode.app",
    });
    expect(api.proposals.markApplied).toHaveBeenCalledWith(
      expect.objectContaining({ appliedResourceId: "node-id" }),
    );
    expect(publishTenantConfig).toHaveBeenCalledWith({
      daoAccountId: "chicago.sputnik-dao.near",
      gatewayId: "citynode.app",
      baseAccount: "everything.near",
      hostname: "chicago.citynode.app",
      title: "Chicago",
    });
    expect(result.applyStatus).toBe("applied");
  });

  it("preserves template application behavior", async () => {
    const templateProposal = proposal("template", { title: "Example" });
    const api = client(templateProposal);
    const publishTenantConfig = vi.fn().mockResolvedValue(undefined);
    await approveAndApplyProposal({
      apiClient: api as unknown as ApiClient,
      proposal: templateProposal,
      gatewayId: "citynode.app",
      baseAccount: "everything.near",
      publishTenantConfig,
    });

    expect(api.template.createThing).toHaveBeenCalledWith({
      thingId: "thing-id",
      payload: { title: "Example" },
    });
    expect(publishTenantConfig).not.toHaveBeenCalled();
  });

  it("marks node application failures", async () => {
    const api = client(proposal("node", nodePayload));
    api.applyNodeProposal.mockRejectedValue(new Error("creation failed"));
    const publishTenantConfig = vi.fn().mockResolvedValue(undefined);

    await expect(
      approveAndApplyProposal({
        apiClient: api as unknown as ApiClient,
        proposal: proposal("node", nodePayload),
        gatewayId: "citynode.app",
        baseAccount: "everything.near",
        publishTenantConfig,
      }),
    ).rejects.toThrow("creation failed");
    expect(api.proposals.markApplyFailed).toHaveBeenCalledWith(
      expect.objectContaining({ error: "creation failed" }),
    );
  });

  it("does not finalize a node application when the DAO publish proposal fails", async () => {
    const api = client(proposal("node", nodePayload));
    const publishTenantConfig = vi.fn().mockRejectedValue(new Error("Trezu rejected the request"));

    await expect(
      approveAndApplyProposal({
        apiClient: api as unknown as ApiClient,
        proposal: proposal("node", nodePayload),
        gatewayId: "citynode.app",
        baseAccount: "everything.near",
        publishTenantConfig,
      }),
    ).rejects.toThrow("Trezu rejected the request");

    expect(api.applyNodeProposal).toHaveBeenCalledOnce();
    expect(api.proposals.markApplied).not.toHaveBeenCalled();
    expect(api.proposals.markApplyFailed).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Trezu rejected the request" }),
    );
  });

  it("approves unsupported plugins without applying them", async () => {
    const unknownProposal = proposal("unknown");
    const api = client(unknownProposal);
    const publishTenantConfig = vi.fn().mockResolvedValue(undefined);
    const result = await approveAndApplyProposal({
      apiClient: api as unknown as ApiClient,
      proposal: unknownProposal,
      gatewayId: "citynode.app",
      baseAccount: "everything.near",
      publishTenantConfig,
    });

    expect(api.applyNodeProposal).not.toHaveBeenCalled();
    expect(api.template.createThing).not.toHaveBeenCalled();
    expect(api.proposals.markApplied).not.toHaveBeenCalled();
    expect(result.reviewStatus).toBe("approved");
  });
});
