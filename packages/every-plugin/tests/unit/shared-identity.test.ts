import { describe, expect, it } from "vitest";
import { MF_CORE_SHARED_DEPS } from "../../src/runtime/mf-config";
import {
  compareSharedIdentity,
  describeSharedIdentityMismatch,
  fetchRemoteIdentityManifest,
} from "../../src/runtime/services/shared-identity";

const expected = new Map(
  Object.entries(MF_CORE_SHARED_DEPS).map(([name, config]) => [name, config.version]),
);

describe("compareSharedIdentity", () => {
  it("passes when remote shared versions match the runtime's expectations", () => {
    const remoteShared = Object.entries(MF_CORE_SHARED_DEPS).map(([name, config]) => ({
      name,
      version: config.version,
    }));
    expect(compareSharedIdentity(remoteShared, expected)).toEqual([]);
  });

  it("flags a prerelease skew on an effect-critical dep", () => {
    const remoteShared = Object.entries(MF_CORE_SHARED_DEPS).map(([name, config]) => ({
      name,
      version: name === "effect" ? "4.0.0-rc.100" : config.version,
    }));
    const mismatches = compareSharedIdentity(remoteShared, expected);
    expect(mismatches).toEqual([
      {
        name: "effect",
        expected: MF_CORE_SHARED_DEPS.effect?.version,
        actual: "4.0.0-rc.100",
      },
    ]);
  });

  it("flags the dep by the critical list, not mere presence", () => {
    const remoteShared = [{ name: "zod", version: "9.0.0-totallydifferent" }];
    expect(compareSharedIdentity(remoteShared, expected)).toEqual([]);
  });

  it("does not flag deps missing from the remote manifest (strictVersion picks that up)", () => {
    const remoteShared = Object.entries(MF_CORE_SHARED_DEPS)
      .filter(([name]) => name !== "effect")
      .map(([name, config]) => ({ name, version: config.version }));
    expect(compareSharedIdentity(remoteShared, expected)).toEqual([]);
  });

  it("ignores unpinned remote versions", () => {
    const remoteShared = Object.entries(MF_CORE_SHARED_DEPS).map(([name]) => ({ name }));
    expect(compareSharedIdentity(remoteShared, expected)).toEqual([]);
  });
});

describe("describeSharedIdentityMismatch", () => {
  it("names the skew, the remedy, and the check", () => {
    const message = describeSharedIdentityMismatch(
      "apps",
      [{ name: "effect", expected: "4.0.0-rc.112", actual: "4.0.0-rc.100" }],
      "this runtime",
    );
    expect(message).toContain("apps");
    expect(message).toContain("effect: expected 4.0.0-rc.112");
    expect(message).toContain("bos mf check");
    expect(message).toContain("redeploy");
  });
});

describe("fetchRemoteIdentityManifest", () => {
  const originalFetch = globalThis.fetch;

  it("splits base and manifest path for entry-style URLs", async () => {
    let requested: string | null = null;
    globalThis.fetch = (async (input: unknown) => {
      requested = String(input);
      return new Response(JSON.stringify({ metaData: {}, shared: [] }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await fetchRemoteIdentityManifest("https://apps.example/remoteEntry.js");
    expect(requested).toBe("https://apps.example/mf-manifest.json");
    globalThis.fetch = originalFetch;
  });

  it("returns null on non-OK responses", async () => {
    globalThis.fetch = (async () =>
      new Response("not found", {
        status: 404,
      })) as unknown as typeof globalThis.fetch;
    expect(await fetchRemoteIdentityManifest("https://down.example")).toBeNull();
    globalThis.fetch = originalFetch;
  });
});
