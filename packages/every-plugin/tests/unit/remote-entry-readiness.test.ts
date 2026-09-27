import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRemoteEntryBody,
  purgeRemoteEntryCache,
  waitForRemoteEntryReady,
} from "../../src/remote-entry";

const globalLoadingKey = (remoteUrl: string) => `everything-dev_demo:${remoteUrl}`;

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__GLOBAL_LOADING_REMOTE_ENTRY__;
  vi.restoreAllMocks();
});

describe("purgeRemoteEntryCache", () => {
  it("deletes only the failed remote's keys", async () => {
    const url = "http://localhost:4112/remoteEntry.js";
    const other = "http://localhost:4114/remoteEntry.js";
    const poisoned = Promise.reject(new Error("poisoned"));
    poisoned.catch(() => {});
    const globalLoading = {
      [globalLoadingKey(url)]: poisoned,
      [globalLoadingKey(other)]: Promise.resolve({}),
    };
    (globalThis as Record<string, unknown>).__GLOBAL_LOADING_REMOTE_ENTRY__ = globalLoading;

    purgeRemoteEntryCache(url);

    expect(globalLoading[globalLoadingKey(url)]).toBeUndefined();
    expect(globalLoading[globalLoadingKey(other)]).toBeDefined();
  });

  it("no-ops when the global cache is absent", () => {
    expect(() => purgeRemoteEntryCache("http://localhost:4110/remoteEntry.js")).not.toThrow();
  });
});

describe("isRemoteEntryBody", () => {
  it("accepts javascript-looking bodies", () => {
    expect(isRemoteEntryBody("module.exports = (() => { ... })();")).toBe(true);
    expect(isRemoteEntryBody("(()=>{var e=...})()")).toBe(true);
  });

  it("rejects 404 and html bodies", () => {
    expect(isRemoteEntryBody("Not Found")).toBe(false);
    expect(isRemoteEntryBody("<!DOCTYPE html><html></html>")).toBe(false);
  });
});

describe("waitForRemoteEntryReady", () => {
  it("returns as soon as the entry is served", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => "module.exports={};" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      waitForRemoteEntryReady("demo", "http://localhost:1/remoteEntry.js"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps polling until the entry is served", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "Not Found" })
      .mockResolvedValueOnce({ ok: true, text: async () => "Not Found" })
      .mockResolvedValue({ ok: true, text: async () => "module.exports={};" });
    vi.stubGlobal("fetch", fetchMock);

    await waitForRemoteEntryReady("demo", "http://localhost:1/remoteEntry.js");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when the deadline passes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, text: async () => "Not Found" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      waitForRemoteEntryReady("demo", "http://localhost:1/remoteEntry.js", 50),
    ).rejects.toThrow("never became ready");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  });
});
