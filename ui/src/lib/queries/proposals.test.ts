import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidateProposalQueries } from "./proposals";

describe("proposal cache freshness", () => {
  it("refreshes review data without marking live nodes or Things as changed", async () => {
    const client = new QueryClient();
    const reviewKeys = [
      ["admin-proposals", "list", "pending"],
      ["admin-proposals", "list", "all"],
      ["admin-proposals", "pending-count"],
      ["admin-proposals", "detail", "proposal-1", "node", "lahore"],
      ["admin-proposals", "review-history", "node"],
    ];
    for (const key of reviewKeys) client.setQueryData(key, []);
    client.setQueryData(["nodes", "list", "roots"], []);
    client.setQueryData(["things-list"], []);

    await invalidateProposalQueries(client);

    for (const key of reviewKeys) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(["nodes", "list", "roots"])?.isInvalidated).toBe(false);
    expect(client.getQueryState(["things-list"])?.isInvalidated).toBe(false);
    client.clear();
  });
});
