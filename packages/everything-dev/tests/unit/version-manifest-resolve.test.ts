import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { clearSlotVersionCache, resolveSlotVersion } from "../../src/version-manifest-resolve";

const sri = (content: string) => `sha384-${createHash("sha384").update(content).digest("base64")}`;

const versionManifest = {
  version: "8f3ac1d2feedbeef",
  builtAt: "2026-09-30T12:00:00.000Z",
  entry: "remoteEntry.cf712c39e56dc37f.js",
  entryIntegrity: "sha384-entry",
  ssr: { entry: "remoteEntry.server.153cffaa.js", integrity: "sha384-ssr" },
  browserManifest: { file: "mf-manifest.f28865c6f7d48917.json", integrity: "sha384-bm" },
};

const manifestUrl =
  "https://cdn.everything.dev/bundles/a.near/g.app/ui/versions/8f3ac1d2feedbeef.json";
const manifestBase = "https://cdn.everything.dev/bundles/a.near/g.app/ui/";
const manifestJson = JSON.stringify(versionManifest);

const okFetch = async (input: string | URL) => {
  if (String(input) === manifestUrl) return new Response(manifestJson, { status: 200 });
  return new Response("nope", { status: 404 });
};

const slot = {
  base: manifestBase,
  pin: {
    manifest: "versions/8f3ac1d2feedbeef.json",
    integrity: sri(manifestJson),
  },
};

describe("resolveSlotVersion", () => {
  it("fetches + verifies the version manifest and derives the entry URLs", async () => {
    clearSlotVersionCache();
    const fetchImpl = vi.fn(okFetch) as typeof fetch;
    const resolved = await resolveSlotVersion({ ...slot, fetchImpl });
    expect(resolved.entryUrl).toBe(`${manifestBase}${versionManifest.entry}`);
    expect(resolved.entryIntegrity).toBe("sha384-entry");
    expect(resolved.browserManifestUrl).toBe(
      `${manifestBase}${versionManifest.browserManifest!.file}`,
    );
    expect(resolved.ssrEntryUrl).toBe(`${manifestBase}${versionManifest.ssr!.entry}`);
    expect(resolved.ssrIntegrity).toBe("sha384-ssr");
  });

  it("caches per pin: the same slot pin fetches the manifest exactly once", async () => {
    clearSlotVersionCache();
    const fetchImpl = vi.fn(okFetch) as typeof fetch;
    await resolveSlotVersion({ ...slot, fetchImpl });
    await resolveSlotVersion({ ...slot, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws on SRI mismatch (nothing cached, nothing derived)", async () => {
    clearSlotVersionCache();
    const fetchImpl = (async () => new Response(manifestJson, { status: 200 })) as typeof fetch;
    await expect(
      resolveSlotVersion({ ...slot, pin: { ...slot.pin, integrity: "sha384-wrong" }, fetchImpl }),
    ).rejects.toThrow(/Integrity/i);
  });

  it("never refetches a verified pin — the cache is the last-known-good", async () => {
    clearSlotVersionCache();
    const fetchImpl = vi.fn(okFetch) as typeof fetch;
    const first = await resolveSlotVersion({ ...slot, fetchImpl });
    const failing = (async () => {
      throw new Error("unreachable");
    }) as typeof fetch;
    const second = await resolveSlotVersion({ ...slot, fetchImpl: failing });
    expect(second).toEqual(first);
  });
});
