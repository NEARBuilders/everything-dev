import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  invalidatePersistedTenantQueries,
  publishPersistedTenantChange,
} from "./-tenant-mutations";

describe("tenant mutation outcomes", () => {
  it("keeps a persisted update successful when config publication fails", async () => {
    const updated = { id: "tenant-1", status: "suspended" };
    const result = await publishPersistedTenantChange(updated, async () => {
      throw new Error("registry unavailable");
    });

    expect(result.updated).toBe(updated);
    expect(result.publicationError?.message).toBe("registry unavailable");
  });

  it("reports a cache refresh failure separately from the persisted update", async () => {
    const client = new QueryClient();
    client.setQueryData(["nodes"], []);
    client.setQueryData(["tenants"], []);
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockRejectedValueOnce(new Error("query transport unavailable"));

    const refreshError = await invalidatePersistedTenantQueries(client);

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(refreshError?.message).toBe("query transport unavailable");
    client.clear();
  });
});
