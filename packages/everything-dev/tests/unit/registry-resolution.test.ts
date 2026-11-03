import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type PlatformReleaseManifest,
  PlatformReleaseManifestSchema,
} from "../../src/services/platform/manifest-schema";
import {
  type ResolutionQuery,
  type ResolutionSeams,
  resolveRelease,
} from "../../src/services/registry/resolution";

const ROOT = "bos://dev.everything.near/everything.dev";

function manifest(frameworkVersion: string): PlatformReleaseManifest {
  return PlatformReleaseManifestSchema.parse({
    schemaVersion: 1,
    kind: "everything-dev/platform-manifest",
    frameworkVersion,
    everyPluginVersion: "1.0.0",
    image: { ref: "ghcr.io/nearbuilders/everything-dev", tags: [`v${frameworkVersion}`] },
    catalog: { effect: "4.0.0" },
    sharedDeps: {},
    templateInventory: [],
    compat: { minChild: "1.0.0" },
  });
}

/** A seam set over in-memory homes: one runtime (ROOT) with an optional tag
 * and version records; the extends chain is a single-node config pointing at
 * it. `throwOnRecord`/`throwOnTag` simulate an unreachable registry. */
function harness(opts?: {
  tag?: unknown;
  records?: Record<string, PlatformReleaseManifest>;
  throwOnTag?: Error;
  throwOnRecord?: Error;
  cache?: { pin?: string; fresh?: boolean };
}) {
  const recordTexts: Record<string, string> = {};
  for (const [version, record] of Object.entries(opts?.records ?? {})) {
    recordTexts[version] = JSON.stringify(record);
  }
  const seams: Partial<ResolutionSeams> = {
    readManifestTag: async () => {
      if (opts?.throwOnTag) throw opts.throwOnTag;
      return opts?.tag ?? null;
    },
    readVersionRecord: async (_ref, release) => {
      if (opts?.throwOnRecord) throw opts.throwOnRecord;
      return recordTexts[release] ?? null;
    },
    parseManifest: (value) => PlatformReleaseManifestSchema.parse(value),
    fetchParent: async () => null,
    cacheRead: (pin) => {
      if (!opts?.cache) return { state: "miss" };
      const record = {
        schemaVersion: 1,
        kind: "everything-dev/platform-manifest-cache" as const,
        resolvedAt: new Date(opts.cache.fresh === false ? 0 : Date.now()).toISOString(),
        source: { account: "dev.everything.near", gateway: "everything.dev" },
        manifest: manifest(opts.cache.pin ?? "1.0.0"),
        provenance: "slot" as const,
      };
      const pinMatch = pin === undefined || record.manifest.frameworkVersion === pin;
      if (!pinMatch) return { state: "stale", record };
      return opts.cache.fresh === false ? { state: "stale", record } : { state: "hit", record };
    },
    cacheWrite: () => {},
    lastWriteAt: async () => "2026-08-20T00:00:00.000Z",
  };
  const localConfig = { extends: "bos://dev.everything.near/everything.dev" };
  return { seams, localConfig };
}

const pinned = (release: string): ResolutionQuery => ({ kind: "Pinned", release });

describe("resolveRelease — the resolution state machine (ticket 03)", () => {
  it("Pinned, version record serves on the root → Resolved(from: version)", async () => {
    const h = harness({ records: { "2.0.0": manifest("2.0.0") } });
    const outcome = await resolveRelease({
      query: pinned("2.0.0"),
      localConfig: h.localConfig,
      seams: h.seams,
    });
    expect(outcome).toMatchObject({
      state: "Resolved",
      from: "version",
      provenance: "slot",
      fromCache: false,
      source: { account: "dev.everything.near", gateway: "everything.dev" },
    });
  });

  it("the thin-tag digest chain verifies the record's bytes — mismatch is Unresolved, never a silent pass", async () => {
    const record = manifest("3.0.0");
    const digest = createHash("sha256").update(JSON.stringify(record)).digest("hex");
    const good = harness({
      tag: { version: "3.0.0", digest },
      records: { "3.0.0": record },
    });
    const resolved = await resolveRelease({
      query: { kind: "Latest" },
      localConfig: good.localConfig,
      seams: good.seams,
    });
    expect(resolved).toMatchObject({
      state: "Resolved",
      from: "manifest",
      provenance: "pointer",
    });

    const tampered = harness({
      tag: { version: "3.0.0", digest },
      records: { "3.0.0": manifest("3.0.1") }, // different bytes, same claimed digest
    });
    const outcome = await resolveRelease({
      query: { kind: "Latest" },
      localConfig: tampered.localConfig,
      seams: tampered.seams,
    });
    expect(outcome).toMatchObject({ state: "Unresolved", reason: "integrityFailure" });
  });

  it("a thin tag whose record is absent is Unresolved(absent), not a pass", async () => {
    const h = harness({ tag: { version: "3.0.0", digest: "beef" } });
    const outcome = await resolveRelease({
      query: { kind: "Latest" },
      localConfig: h.localConfig,
      seams: h.seams,
    });
    expect(outcome).toMatchObject({ state: "Unresolved", reason: "absent" });
    if (outcome.state === "Unresolved") {
      expect(outcome.detail).toContain("3.0.0");
    }
  });

  it("a pinned record read failure with a fresh pin-matched cache → the cache stand-in", async () => {
    const h = harness({
      throwOnRecord: new Error("registry unreachable"),
      cache: { pin: "2.0.0", fresh: true },
    });
    // the cached manifest must BE the pinned release — harness builds it from cache.pin
    const outcome = await resolveRelease({
      query: pinned("2.0.0"),
      localConfig: h.localConfig,
      seams: h.seams,
    });
    expect(outcome).toMatchObject({ state: "Resolved", from: "cache", fromCache: true });
  });

  it("a pinned record read failure with a cache that is NOT the pin → Unresolved(unreachable)", async () => {
    const h = harness({
      throwOnRecord: new Error("registry unreachable"),
      cache: { pin: "1.0.0", fresh: true }, // cached release ≠ the pinned 2.0.0
    });
    const outcome = await resolveRelease({
      query: pinned("2.0.0"),
      localConfig: h.localConfig,
      seams: h.seams,
    });
    expect(outcome).toMatchObject({
      state: "Unresolved",
      reason: "unreachable",
      context: { failureAt: { account: "dev.everything.near", gateway: "everything.dev" } },
    });
  });

  it("a pinned record miss across the chain is Unresolved(absent) — the cache never stands in for a clean miss", async () => {
    const h = harness({ records: {}, cache: { pin: "2.0.0", fresh: true } });
    const outcome = await resolveRelease({
      query: pinned("2.0.0"),
      localConfig: h.localConfig,
      seams: h.seams,
    });
    // #574 semantics: absence means the release leg never published — the
    // actionable error, not a masked stand-in.
    expect(outcome).toMatchObject({ state: "Unresolved", reason: "absent" });
    if (outcome.state === "Unresolved") {
      expect(outcome.detail).toContain("2.0.0");
    }
  });

  it("cold cache + absent → Unresolved naming the chain and the dead end", async () => {
    const h = harness({ tag: null, records: {} });
    const outcome = await resolveRelease({
      query: { kind: "Latest" },
      localConfig: h.localConfig,
      seams: h.seams,
    });
    expect(outcome).toMatchObject({
      state: "Unresolved",
      reason: "absent",
      context: {
        chain: [ROOT],
        tagServes: "none",
        deadEnd: { ref: ROOT, lastWrite: "2026-08-20T00:00:00.000Z" },
      },
    });
  });

  it("Latest, tag absent + fresh cache → the cache stand-in", async () => {
    const h = harness({ tag: null, cache: { fresh: true } });
    const outcome = await resolveRelease({
      query: { kind: "Latest" },
      localConfig: h.localConfig,
      seams: h.seams,
    });
    expect(outcome).toMatchObject({
      state: "Resolved",
      from: "cache",
      provenance: "slot",
      fromCache: true,
    });
  });

  it("Latest, tag absent + stale cache → Unresolved", async () => {
    const h = harness({ tag: null, cache: { fresh: false } });
    const outcome = await resolveRelease({
      query: { kind: "Latest" },
      localConfig: h.localConfig,
      seams: h.seams,
    });
    expect(outcome).toMatchObject({
      state: "Unresolved",
      reason: "absent",
      context: { deadEnd: { ref: ROOT } },
    });
  });

  it("Latest + unreachable tag home → Unresolved(unreachable) with the failure node named", async () => {
    const h = harness({ throwOnTag: new Error("FastKV request failed") });
    const outcome = await resolveRelease({
      query: { kind: "Latest" },
      localConfig: h.localConfig,
      seams: h.seams,
    });
    expect(outcome).toMatchObject({
      state: "Unresolved",
      reason: "unreachable",
      detail: "FastKV request failed",
      context: {
        failureAt: { account: "dev.everything.near", gateway: "everything.dev" },
      },
    });
  });

  it("a full (pre-cutover) tag serves Latest → Resolved(from: manifest), tagServes full", async () => {
    const h = harness({ tag: manifest("1.5.0") });
    const outcome = await resolveRelease({
      query: { kind: "Latest" },
      localConfig: h.localConfig,
      seams: h.seams,
    });
    expect(outcome).toMatchObject({
      state: "Resolved",
      from: "manifest",
      provenance: "pointer",
      fromCache: false,
    });
    expect(outcome.state === "Resolved" && outcome.manifest.frameworkVersion).toBe("1.5.0");
  });
});
