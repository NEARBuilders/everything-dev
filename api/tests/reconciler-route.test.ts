import { describe, expect, it } from "vitest";
import { authedContext, getPluginClient } from "./setup";

describe("reconciler status route", () => {
  it("refuses unauthenticated calls", async () => {
    const client = await getPluginClient();
    await expect(client.hosting.reconcilerStatus({})).rejects.toThrow(/Authentication required/);
  });

  it("reports a disabled reconciler when no watch list is configured", async () => {
    const client = await getPluginClient(authedContext("operator-1"));
    const status = await client.hosting.reconcilerStatus({});
    expect(status).toEqual({
      enabled: false,
      pollIntervalMs: 15000,
      namespaces: [],
    });
  });
});
