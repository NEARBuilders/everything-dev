import { describe, expect, it } from "vitest";
import { authedContext, getPluginClient } from "./setup";

describe("rollback route", () => {
  it("refuses unauthenticated calls", async () => {
    const client = await getPluginClient();
    await expect(
      client.hosting.rollback({ account: "a.near", gateway: "a.dev", blockHeight: 1 }),
    ).rejects.toThrow(/Authentication required/);
  });

  it("refuses when the runtime has no rollback config", async () => {
    const client = await getPluginClient(authedContext("operator-1"));
    const result = await client.hosting.rollback({
      account: "a.near",
      gateway: "a.dev",
      blockHeight: 1,
    });
    expect(result).toMatchObject({
      status: "refused",
      reason: expect.stringMatching(/not configured/i),
    });
  });
});
