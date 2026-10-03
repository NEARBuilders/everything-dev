import { describe, expect, it, vi } from "vitest";
import { createPluginsClient, type PluginResult } from "../../src/services/plugins";

function fakeResult(leaves: Record<string, unknown>): PluginResult {
  return {
    api: {
      createClient: () => leaves,
    },
    plugins: {},
  } as unknown as PluginResult;
}

describe("createPluginsClient call deadline", () => {
  it("rejects a hanging procedure call with a named timeout error", async () => {
    const hanging = () => new Promise(() => {});
    const client = createPluginsClient(fakeResult({ things: { list: hanging } }), undefined, {
      callTimeoutMs: 40,
    }) as { things: { list: () => Promise<unknown> } };

    await expect(client.things.list()).rejects.toThrow(
      "[SSR] plugin.things.list() exceeded 40ms call deadline",
    );
  });

  it("resolves fast calls normally and clears the timer", async () => {
    const fast = vi.fn(async () => ({ ok: true }));
    const client = createPluginsClient(fakeResult({ ping: fast }), undefined, {
      callTimeoutMs: 5_000,
    }) as { ping: () => Promise<unknown> };

    await expect(client.ping()).resolves.toEqual({ ok: true });
    expect(fast).toHaveBeenCalledTimes(1);
  });

  it("traverses namespaces and preserves non-function values", async () => {
    const client = createPluginsClient(
      fakeResult({ meta: { version: "1.0", load: () => Promise.resolve("loaded") } }),
      undefined,
      { callTimeoutMs: 1_000 },
    ) as { meta: { version: string; load: () => Promise<string> } };

    expect(client.meta.version).toBe("1.0");
    await expect(client.meta.load()).resolves.toBe("loaded");
  });

  it("propagates the underlying call's rejection", async () => {
    const failing = () => Promise.reject(new Error("plugin boom"));
    const client = createPluginsClient(fakeResult({ boom: failing }), undefined, {
      callTimeoutMs: 1_000,
    }) as { boom: () => Promise<unknown> };

    await expect(client.boom()).rejects.toThrow("plugin boom");
  });

  it("leaves calls unwrapped when no deadline is set", async () => {
    const hanging = vi.fn(() => new Promise(() => {}));
    const client = createPluginsClient(fakeResult({ hang: hanging })) as {
      hang: () => Promise<unknown>;
    };

    const pending = client.hang();
    expect(pending).toBeInstanceOf(Promise);
    expect(hanging).toHaveBeenCalledTimes(1);
  });
});
