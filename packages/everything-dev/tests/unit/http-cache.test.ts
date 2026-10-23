import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearHttpCache, fetchJsonOrNull, httpCacheSize } from "../../src/utils/http-client";

describe("GET cache bound (#339)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
    clearHttpCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearHttpCache();
  });

  it("stays bounded at the cache cap across distinct URLs (oldest evicted)", async () => {
    const fetchStub = vi.fn(
      async (url: string | URL) =>
        new Response(JSON.stringify({ url: String(url) }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const total = 300;
    for (let i = 0; i < total; i++) {
      await fetchJsonOrNull(`https://fastkv.example/config-${i}`);
    }

    expect(fetchStub).toHaveBeenCalledTimes(total);
    expect(httpCacheSize()).toBeLessThanOrEqual(128);
    expect(httpCacheSize()).toBeGreaterThan(0);

    await fetchJsonOrNull("https://fastkv.example/config-0");
    expect(fetchStub).toHaveBeenCalledTimes(total + 1);
  });

  it("prefers dropping expired entries before evicting live ones", async () => {
    const fetchStub = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchStub);

    for (let i = 0; i < 128; i++) {
      await fetchJsonOrNull(`https://fastkv.example/bulk-${i}`);
    }
    expect(httpCacheSize()).toBe(128);

    vi.setSystemTime(new Date("2026-10-14T00:01:00Z"));

    await fetchJsonOrNull("https://fastkv.example/after-expiry");

    expect(httpCacheSize()).toBe(1);
  });
});
