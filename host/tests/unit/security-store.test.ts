import { describe, expect, it } from "vitest";
import { CappedStore } from "../../src/middleware/security";

describe("CappedStore", () => {
  it("counts hits within a window", () => {
    const store = new CappedStore(10);
    const first = store.increment("a");
    expect(first.totalHits).toBe(1);
    const second = store.increment("a");
    expect(second.totalHits).toBe(2);
  });

  it("starts a fresh window after resetTime passes", () => {
    const store = new CappedStore(10);
    const entry = store.increment("a");
    entry.resetTime = new Date(Date.now() - 1);
    const next = store.increment("a");
    expect(next.totalHits).toBe(1);
    expect(next.resetTime!.getTime()).toBeGreaterThan(Date.now());
  });

  it("get returns live entries and drops expired ones", () => {
    const store = new CappedStore(10);
    store.increment("a");
    expect(store.get("a")?.totalHits).toBe(1);
    const entry = store.get("a");
    entry!.resetTime = new Date(Date.now() - 1);
    store.increment("a").resetTime = new Date(Date.now() - 1);
    expect(store.get("a")).toBeUndefined();
  });

  it("never exceeds the entry cap — expired entries go first, then oldest-inserted", () => {
    const store = new CappedStore(3);
    store.increment("live-1");
    store.increment("live-2");
    const expiring = store.increment("expiring");
    expiring.resetTime = new Date(Date.now() - 1);

    store.increment("c");
    store.increment("d");

    expect(store.get("expiring")).toBeUndefined();
    expect(store.get("live-1")).toBeUndefined();
    expect(store.get("live-2")).toBeDefined();
    expect(store.get("c")).toBeDefined();
    expect(store.get("d")).toBeDefined();
  });

  it("decrement lowers the count without going negative", () => {
    const store = new CappedStore(10);
    store.increment("a");
    store.increment("a");
    store.decrement("a");
    expect(store.get("a")?.totalHits).toBe(1);
    store.decrement("a");
    store.decrement("a");
    expect(store.get("a")?.totalHits).toBe(0);
  });

  it("resetKey and resetAll clear entries", () => {
    const store = new CappedStore(10);
    store.increment("a");
    store.increment("b");
    store.resetKey("a");
    expect(store.get("a")).toBeUndefined();
    store.resetAll();
    expect(store.get("b")).toBeUndefined();
  });
});
