import { describe, expect, it } from "vitest";
import { enforceCacheLimit, pruneExpiredEntries } from "../../src/services/ttl-cache";

describe("enforceCacheLimit", () => {
  it("drops the oldest entries first and never exceeds the limit", () => {
    const cache = new Map<string, number>();
    for (let i = 0; i < 10; i++) cache.set(`k${i}`, i);
    enforceCacheLimit(cache, 3);
    expect([...cache.keys()]).toEqual(["k7", "k8", "k9"]);

    cache.set("k0", 0);
    enforceCacheLimit(cache, 3);
    expect([...cache.keys()]).toEqual(["k8", "k9", "k0"]);
  });

  it("is a no-op at or under the limit", () => {
    const cache = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    enforceCacheLimit(cache, 2);
    enforceCacheLimit(cache, 5);
    expect([...cache.keys()]).toEqual(["a", "b"]);
  });
});

describe("pruneExpiredEntries", () => {
  it("removes only entries whose expiry has passed", () => {
    const cache = new Map<string, { expiresAt: number; value: string }>();
    cache.set("fresh", { expiresAt: 20, value: "fresh" });
    cache.set("stale", { expiresAt: 10, value: "stale" });
    cache.set("edge", { expiresAt: 15, value: "edge" });
    pruneExpiredEntries(cache, 15);
    expect([...cache.keys()]).toEqual(["fresh"]);
  });
});
