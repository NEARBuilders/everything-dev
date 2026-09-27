import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/app";
import {
  adminProposalDetailQueryOptions,
  adminProposalListQueryOptions,
  parseProposalReviewFilter,
  proposalReviewHistoryQueryOptions,
  proposalReviewQueryKeys,
  proposalReviewStatusVariant,
  proposalTitle,
  proposalTypeLabel,
} from "./-proposal-review";

describe("proposal review filters", () => {
  it.each(["pending", "approved", "rejected", "all"])("accepts %s", (filter) => {
    expect(parseProposalReviewFilter(filter)).toBe(filter);
  });

  it.each([undefined, null, "removed", "unknown", 1])("rejects %s", (filter) => {
    expect(parseProposalReviewFilter(filter)).toBeUndefined();
  });

  it("keys the review list by filter and forwards pagination cursors", async () => {
    const getProposals = vi.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, hasMore: false, nextCursor: null },
    });
    const apiClient = { proposals: { getProposals } } as unknown as ApiClient;
    const options = adminProposalListQueryOptions(apiClient, "approved");

    expect(options.queryKey).toEqual(proposalReviewQueryKeys.list("approved"));
    await options.queryFn?.({ pageParam: "50" } as never);

    expect(getProposals).toHaveBeenCalledWith({
      reviewStatus: "approved",
      limit: 50,
      cursor: "50",
    });
  });

  it("does not send a review status for the all filter", async () => {
    const getProposals = vi.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, hasMore: false, nextCursor: null },
    });
    const apiClient = { proposals: { getProposals } } as unknown as ApiClient;
    const options = adminProposalListQueryOptions(apiClient, "all");

    await options.queryFn?.({ pageParam: undefined } as never);

    expect(getProposals).toHaveBeenCalledWith({ limit: 50 });
  });

  it("centralizes detail and review-history query keys", () => {
    const apiClient = { proposals: {} } as unknown as ApiClient;

    expect(
      adminProposalDetailQueryOptions(apiClient, "proposal-1", "node", "pakistan").queryKey,
    ).toEqual(proposalReviewQueryKeys.detail("proposal-1", "node", "pakistan"));
    expect(proposalReviewHistoryQueryOptions(apiClient, "node").queryKey).toEqual(
      proposalReviewQueryKeys.history("node"),
    );
  });
});

describe("proposal review status variants", () => {
  it("maps review states to semantic badge variants", () => {
    expect(proposalReviewStatusVariant("pending")).toBe("warning");
    expect(proposalReviewStatusVariant("approved")).toBe("success");
    expect(proposalReviewStatusVariant("rejected")).toBe("destructive");
    expect(proposalReviewStatusVariant("removed")).toBe("outline");
  });
});

describe("proposal titles", () => {
  const nodePayload = {
    kind: "city",
    parentId: "country-1",
    name: "Chicago",
    slug: "chicago",
    motivation: "Local builders",
    orgId: "org-1",
    accountId: "chicago.sputnik-dao.near",
    submitterAccountId: "alice.near",
  };

  it("names a community application after the proposed community", () => {
    expect(proposalTitle({ pluginId: "node", entityId: "node-entity", payload: nodePayload })).toBe(
      "Chicago",
    );
  });

  it("falls back to the entity id for other or malformed payloads", () => {
    expect(proposalTitle({ pluginId: "node", entityId: "node-entity", payload: {} })).toBe(
      "node-entity",
    );
    expect(proposalTitle({ pluginId: "template", entityId: "thing-1", payload: nodePayload })).toBe(
      "thing-1",
    );
  });

  it("labels proposal types in plain words", () => {
    expect(proposalTypeLabel("node")).toBe("Community");
    expect(proposalTypeLabel("template")).toBe("Thing");
    expect(proposalTypeLabel("votes")).toBe("Votes");
  });
});
