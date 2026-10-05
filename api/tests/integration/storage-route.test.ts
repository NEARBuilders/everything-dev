import { afterAll, describe, expect, it } from "vitest";
import { getPluginClient, teardown } from "../setup";

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

const sessionContext = (accountId = "dev.everything.near") => ({
  userId: "user-1",
  user: { id: "user-1", email: "user-1@example.com", name: "Test User" },
  near: { primaryAccountId: accountId },
});

afterAll(async () => {
  await teardown();
});

describe("uploadStorageBundle route", () => {
  it("rejects unauthenticated uploads", async () => {
    const client = await getPluginClient({});
    await expect(
      client.uploadStorageBundle({
        account: "dev.everything.near",
        gateway: "everything.dev",
        workspace: "ui",
        files: [{ path: "remoteEntry.js", contentBase64: base64("export {}") }],
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  it("rejects sessions without a linked NEAR account", async () => {
    const client = await getPluginClient({ userId: "user-1", user: { id: "user-1" } });
    await expect(
      client.uploadStorageBundle({
        account: "dev.everything.near",
        gateway: "everything.dev",
        workspace: "ui",
        files: [{ path: "remoteEntry.js", contentBase64: base64("export {}") }],
      }),
    ).rejects.toThrow(/Link a NEAR account/);
  });

  it("pins session uploads to the authenticated account", async () => {
    const client = await getPluginClient(sessionContext("other.near"));
    await expect(
      client.uploadStorageBundle({
        account: "dev.everything.near",
        gateway: "everything.dev",
        workspace: "ui",
        files: [{ path: "remoteEntry.js", contentBase64: base64("export {}") }],
      }),
    ).rejects.toThrow(/pinned to the authenticated account/);
  });

  it("rejects malformed namespaces and traversal paths", async () => {
    const client = await getPluginClient(sessionContext());

    await expect(
      client.uploadStorageBundle({
        account: "../etc",
        gateway: "everything.dev",
        workspace: "ui",
        files: [{ path: "remoteEntry.js", contentBase64: base64("export {}") }],
      }),
    ).rejects.toThrow(/Invalid bundle namespace/);

    await expect(
      client.uploadStorageBundle({
        account: "dev.everything.near",
        gateway: "everything.dev",
        workspace: "ui",
        files: [{ path: "../escape.js", contentBase64: base64("export {}") }],
      }),
    ).rejects.toThrow(/Invalid bundle object path/);
  });

  it("stores files, reports server-computed SRI, and discloses the backend", async () => {
    const client = await getPluginClient(sessionContext());
    const result = await client.uploadStorageBundle({
      account: "dev.everything.near",
      gateway: "everything.dev",
      workspace: "ui",
      files: [
        { path: "remoteEntry.js", contentBase64: base64("export {};") },
        { path: "static/js/async/x.1234abcd.js", contentBase64: base64("console.log(1)") },
      ],
    });
    expect(result.stored).toBe(2);
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(Object.keys(result.integrity).sort()).toEqual([
      "remoteEntry.js",
      "static/js/async/x.1234abcd.js",
    ]);
    for (const sri of Object.values(result.integrity)) {
      expect(sri).toMatch(/^sha384-[A-Za-z0-9+/=]{64}$/);
    }
    expect(result.storage).toBe("memory");
  });

  it("rejects uploads whose files decode to zero bytes", async () => {
    const client = await getPluginClient(sessionContext());
    await expect(
      client.uploadStorageBundle({
        account: "dev.everything.near",
        gateway: "everything.dev",
        workspace: "ui",
        files: [{ path: "empty.js", contentBase64: " " }],
      }),
    ).rejects.toThrow(/Empty bundle file/);
  });
});
