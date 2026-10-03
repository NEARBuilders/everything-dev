import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidateThingAfterDelete, invalidateThingAfterProposal } from "./-thing-cache";

function seed(client: QueryClient, keys: readonly (readonly string[])[]) {
  for (const key of keys) client.setQueryData(key, []);
}

describe("Thing cache freshness", () => {
  it("invalidates the deleted Thing detail, proposal, list, and vote caches", async () => {
    const client = new QueryClient();
    const affected = [
      ["things-list"],
      ["thing", "thing-1"],
      ["thing-proposal", "thing-1"],
      ["thing-upvote-count", "thing-1"],
      ["thing-user-vote", "thing-1"],
      ["thing-upvote-counts"],
    ] as const;
    seed(client, [...affected, ["thing", "thing-2"], ["thing-proposal", "thing-2"]]);

    await invalidateThingAfterDelete(client, "thing-1");

    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(["thing", "thing-2"])?.isInvalidated).toBe(false);
    expect(client.getQueryState(["thing-proposal", "thing-2"])?.isInvalidated).toBe(false);
    client.clear();
  });

  it("refreshes a submitted Thing detail and review data without refreshing the live list", async () => {
    const client = new QueryClient();
    seed(client, [
      ["thing", "thing-1"],
      ["thing-proposal", "thing-1"],
      ["admin-proposals", "list", "pending"],
      ["admin-proposals", "pending-count"],
      ["things-list"],
    ]);

    await invalidateThingAfterProposal(client, "thing-1");

    expect(client.getQueryState(["thing", "thing-1"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["thing-proposal", "thing-1"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["admin-proposals", "list", "pending"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["admin-proposals", "pending-count"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["things-list"])?.isInvalidated).toBe(false);
    client.clear();
  });
});
