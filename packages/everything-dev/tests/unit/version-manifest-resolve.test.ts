import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("resolveSlotVersion — staged namespace preference", () => {
  const stagedManifest = {
    version: "deadbeefcafe0123",
    entry: "remoteEntry.freshface0badde42.js",
    entryIntegrity: "sha384-c3RhZ2VkZW50cnk=",
  };
  const stagedManifestJson = JSON.stringify(stagedManifest);
  const originalBundleDir = process.env.BOS_BUNDLE_DIR;
  let bundleRoot: string;

  const stage = (slot: string, manifestName: string, body: string) => {
    const dir = path.join(bundleRoot, "a.near", "g.app", slot, "versions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, manifestName), body);
  };

  beforeEach(() => {
    bundleRoot = mkdtempSync(path.join(tmpdir(), "staged-slots-"));
    clearSlotVersionCache();
  });

  afterEach(() => {
    if (originalBundleDir === undefined) delete process.env.BOS_BUNDLE_DIR;
    else process.env.BOS_BUNDLE_DIR = originalBundleDir;
    rmSync(bundleRoot, { recursive: true, force: true });
  });

  it("resolves from the staged dist when the pinned manifest predates the image", async () => {
    process.env.BOS_BUNDLE_DIR = bundleRoot;
    stage("ui", "freshface0badde42.json", stagedManifestJson);
    const fetchImpl = vi.fn(okFetch) as typeof fetch;

    const resolved = await resolveSlotVersion({
      ...slot,
      pin: { manifest: "versions/stale-old-pin.json", integrity: sri(stagedManifestJson) },
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolved.entryUrl).toBe(`${manifestBase}${stagedManifest.entry}`);
    expect(resolved.entryIntegrity).toBe("sha384-c3RhZ2VkZW50cnk=");
  });

  it("keeps the pinned resolution when the pinned manifest is staged", async () => {
    process.env.BOS_BUNDLE_DIR = bundleRoot;
    stage("ui", "8f3ac1d2feedbeef.json", stagedManifestJson);
    const fetchImpl = vi.fn(okFetch) as typeof fetch;

    const resolved = await resolveSlotVersion({ ...slot, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolved.entryUrl).toBe(`${manifestBase}${versionManifest.entry}`);
  });

  it("falls through to the network when the slot is absent from the staged namespace", async () => {
    process.env.BOS_BUNDLE_DIR = bundleRoot;
    stage("other-workspace", "freshface0badde42.json", stagedManifestJson);
    const fetchImpl = vi.fn(okFetch) as typeof fetch;

    const resolved = await resolveSlotVersion({ ...slot, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolved.entryUrl).toBe(`${manifestBase}${versionManifest.entry}`);
  });

  it("falls through to the network without BOS_BUNDLE_DIR", async () => {
    delete process.env.BOS_BUNDLE_DIR;
    const fetchImpl = vi.fn(okFetch) as typeof fetch;

    const resolved = await resolveSlotVersion({ ...slot, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolved.entryUrl).toBe(`${manifestBase}${versionManifest.entry}`);
  });

  it("prefers the newest staged manifest when several are present", async () => {
    process.env.BOS_BUNDLE_DIR = bundleRoot;
    const versionsDir = path.join(bundleRoot, "a.near", "g.app", "ui", "versions");
    mkdirSync(versionsDir, { recursive: true });
    const older = path.join(versionsDir, "older00000000000a.json");
    const newer = path.join(versionsDir, "newer00000000000b.json");
    writeFileSync(older, JSON.stringify({ ...stagedManifest, entry: "remoteEntry.older.js" }));
    writeFileSync(newer, stagedManifestJson);
    utimesSync(older, new Date(0), new Date(0));
    utimesSync(newer, new Date(1), new Date(1));
    const fetchImpl = vi.fn(okFetch) as typeof fetch;

    const resolved = await resolveSlotVersion({
      ...slot,
      pin: { manifest: "versions/stale-old-pin.json", integrity: sri(stagedManifestJson) },
      fetchImpl,
    });

    expect(resolved.entryUrl).toBe(`${manifestBase}${stagedManifest.entry}`);
  });

  it("falls through to the network when the staged dist carries no version manifests", async () => {
    process.env.BOS_BUNDLE_DIR = bundleRoot;
    mkdirSync(path.join(bundleRoot, "a.near", "g.app", "ui", "chunks"), { recursive: true });
    const fetchImpl = vi.fn(okFetch) as typeof fetch;

    const resolved = await resolveSlotVersion({ ...slot, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolved.entryUrl).toBe(`${manifestBase}${versionManifest.entry}`);
  });

  it("falls through to the network when the staged manifest is unparsable", async () => {
    process.env.BOS_BUNDLE_DIR = bundleRoot;
    stage("ui", "broken0000000000aa.json", "{ not json");
    const fetchImpl = vi.fn(okFetch) as typeof fetch;

    const resolved = await resolveSlotVersion({ ...slot, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolved.entryUrl).toBe(`${manifestBase}${versionManifest.entry}`);
  });
});
