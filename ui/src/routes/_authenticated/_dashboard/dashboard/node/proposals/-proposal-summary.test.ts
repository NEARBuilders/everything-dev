import { describe, expect, it } from "vitest";
import {
  applyStatusLabel,
  proposalTitle,
  reviewStatusBadge,
  sortProposals,
} from "./-proposal-summary";

describe("node proposal summary", () => {
  it("titles a proposal by its name, then its changed fields", () => {
    expect(proposalTitle({ name: "Harbor City", slug: "harbor" }, "x")).toBe("Harbor City");
    expect(proposalTitle({ metadata: {}, validators: [] }, "x")).toBe(
      "Change metadata, validators",
    );
    expect(proposalTitle({ a: 1, b: 2, c: 3, d: 4, e: 5 }, "x")).toBe("Change a, b, c and 2 more");
    expect(proposalTitle(null, "Proposal")).toBe("Proposal");
  });

  it("maps statuses to readable badges", () => {
    expect(reviewStatusBadge("pending")).toEqual({ label: "Awaiting review", variant: "warning" });
    expect(reviewStatusBadge("rejected").variant).toBe("destructive");
    expect(applyStatusLabel("not_started")).toBeNull();
    expect(applyStatusLabel("applied")).toBe("Live");
  });

  it("lists pending proposals first, newest first", () => {
    const sorted = sortProposals([
      { id: "old-approved", reviewStatus: "approved", createdAt: "2026-01-03T00:00:00Z" },
      { id: "old-pending", reviewStatus: "pending", createdAt: "2026-01-01T00:00:00Z" },
      { id: "new-pending", reviewStatus: "pending", createdAt: "2026-01-02T00:00:00Z" },
    ] as const);
    expect(sorted.map((p) => p.id)).toEqual(["new-pending", "old-pending", "old-approved"]);
  });
});
