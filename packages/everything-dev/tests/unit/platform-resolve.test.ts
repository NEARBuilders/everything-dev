import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  composePlatformReleaseManifest,
  type Manifest,
  resolvePlatformManifest,
  serializePlatformReleaseManifest,
} from "../../src/services/platform/manifest";
import { manifestTagOf } from "../../src/services/platform/manifest-schema";

let tmpRoot: string;

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function makeManifest(frameworkVersion: string): Manifest {
  return composePlatformReleaseManifest({
    frameworkVersion,
    everyPluginVersion: "3.0.0-rc.9",
    imageRef: "ghcr.io/nearbuilders/everything-dev",
    catalog: {},
    templateInventory: [],
    compatMinChild: frameworkVersion,
  });
}

function makeTag(manifest: Manifest) {
  return manifestTagOf(manifest, serializePlatformReleaseManifest(manifest));
}

function harness(opts: {
  chain: Array<{
    account: string;
    gateway: string;
    /** the manifest the node's thin tag points at (the moving home) */
    manifest?: Manifest;
    config?: Record<string, unknown>;
    /** immutable version records (#574): release version → manifest */
    records?: Record<string, Manifest>;
    /** simulate an unreachable registry for the record reads (offline dev) */
    failRecordReads?: boolean;
  }>;
  cached?: {
    manifest: Manifest;
    source: { account: string; gateway: string };
    resolvedAt?: string;
    provenance?: "record" | "pointer";
  };
  useDefaultCache?: boolean;
  /** injectable clock for the cache-freshness check */
  now?: () => number;
}) {
  const writes: Array<unknown> = [];
  const fetchTag = async (account: string, gateway: string) => {
    const manifest = opts.chain.find(
      (n) => n.account === account && n.gateway === gateway,
    )?.manifest;
    return manifest ? makeTag(manifest) : null;
  };
  const fetchRecord = async (account: string, gateway: string, version: string) => {
    const node = opts.chain.find((n) => n.account === account && n.gateway === gateway);
    if (!node) return null;
    if (node.failRecordReads) throw new Error("registry unreachable");
    if (node.records?.[version]) return node.records[version];
    // a node's tag manifest doubles as its own version record
    if (node.manifest && node.manifest.frameworkVersion === version) return node.manifest;
    return null;
  };
  const fetchParent = async (account: string, gateway: string) =>
    opts.chain.find((n) => n.account === account && n.gateway === gateway)?.config ?? null;
  return {
    writes,
    run: (localConfig: Record<string, unknown>) => {
      tmpRoot = mkdtempSync(join(tmpdir(), "platform-resolve-"));
      return resolvePlatformManifest({
        configDir: tmpRoot,
        localConfig,
        fetchTag,
        fetchRecord,
        fetchParent,
        ...(opts.now ? { now: opts.now } : {}),
        ...(opts.useDefaultCache
          ? {}
          : {
              cacheRead: () =>
                opts.cached
                  ? {
                      ...opts.cached,
                      resolvedAt: opts.cached.resolvedAt ?? new Date().toISOString(),
                    }
                  : null,
              cacheWrite: (cached: unknown) => writes.push(cached),
            }),
      });
    },
  };
}

const childConfig = { extends: "bos://root.near/root" };

describe("resolvePlatformManifest", () => {
  it("with no pin, the nearest manifest in the extends chain wins", async () => {
    const h = harness({
      chain: [{ account: "root.near", gateway: "root", manifest: makeManifest("2.0.0-rc.14") }],
    });
    const resolved = await h.run(childConfig);
    expect(resolved?.manifest.frameworkVersion).toBe("2.0.0-rc.14");
    expect(resolved?.source).toEqual({ account: "root.near", gateway: "root" });
    expect(resolved?.fromCache).toBe(false);
  });

  it("an exact pin resolves from the immutable version record and caches", async () => {
    const h = harness({
      chain: [
        {
          account: "root.near",
          gateway: "root",
          manifest: makeManifest("2.0.0-rc.14"),
          config: { extends: "bos://mid.near/mid" },
          records: { "2.1.0": makeManifest("2.1.0") },
        },
        { account: "mid.near", gateway: "mid", manifest: makeManifest("2.1.0") },
      ],
    });
    const resolved = await h.run({ ...childConfig, release: "2.1.0" });
    expect(resolved?.manifest.frameworkVersion).toBe("2.1.0");
    expect(resolved?.provenance).toBe("record");
    expect(resolved?.source).toEqual({ account: "root.near", gateway: "root" });
    expect(h.writes).toHaveLength(1);
  });

  it("permanent resolution (#574): a pin to an older release still resolves after the pointer flipped", async () => {
    // the root republished past the child's pin — the pointer says rc.15,
    // the child pins rc.14 — the immutable remote serves it forever
    const h = harness({
      chain: [
        {
          account: "root.near",
          gateway: "root",
          manifest: makeManifest("2.0.0-rc.15"),
          records: { "2.0.0-rc.14": makeManifest("2.0.0-rc.14") },
        },
      ],
    });
    const resolved = await h.run({ ...childConfig, release: "2.0.0-rc.14" });
    expect(resolved?.manifest.frameworkVersion).toBe("2.0.0-rc.14");
    expect(resolved?.provenance).toBe("record");
    expect(resolved?.fromCache).toBe(false);
  });

  it("unpinned resolution reads the pointer — provenance pointer, behavior unchanged", async () => {
    const h = harness({
      chain: [{ account: "root.near", gateway: "root", manifest: makeManifest("2.0.0-rc.15") }],
    });
    const resolved = await h.run(childConfig);
    expect(resolved?.manifest.frameworkVersion).toBe("2.0.0-rc.15");
    expect(resolved?.provenance).toBe("pointer");
  });

  it("a pin the chain cannot satisfy fails loud", async () => {
    const h = harness({
      chain: [{ account: "root.near", gateway: "root", manifest: makeManifest("2.0.0-rc.14") }],
    });
    await expect(h.run({ ...childConfig, release: "9.0.0" })).rejects.toThrow(
      /9\.0\.0.*never published/s,
    );
  });

  it("a record read failure without a matching cache fails loud naming the record key", async () => {
    const h = harness({
      chain: [
        {
          account: "root.near",
          gateway: "root",
          manifest: makeManifest("2.0.0-rc.14"),
          failRecordReads: true,
        },
      ],
    });
    await expect(h.run({ ...childConfig, release: "2.0.0-rc.14" })).rejects.toThrow(
      /versions\/2\.0\.0-rc\.14\.json/,
    );
  });

  it("a clean record miss does not fall back to the cache — the actionable error names the release", async () => {
    // the record's absence is authoritative (the release's manifest leg never
    // published, #568) — a matching cache must not paper over it
    const h = harness({
      chain: [
        {
          account: "root.near",
          gateway: "root",
          manifest: makeManifest("2.0.0-rc.15"),
        },
      ],
      cached: {
        manifest: makeManifest("9.0.0"),
        source: { account: "root.near", gateway: "root" },
      },
    });
    await expect(h.run({ ...childConfig, release: "9.0.0" })).rejects.toThrow(/never published/);
  });

  it("no manifest anywhere → null (today's behavior, ADR 0034 pt 7)", async () => {
    const h = harness({
      chain: [{ account: "root.near", gateway: "root", config: { extends: "bos://a.near/b" } }],
    });
    expect(await h.run(childConfig)).toBeNull();
  });

  it("offline (record reads fail) with a cache matching the pin → the cached manifest (fromCache)", async () => {
    const cachedManifest = makeManifest("2.0.0-rc.14");
    const h = harness({
      chain: [
        {
          account: "root.near",
          gateway: "root",
          manifest: makeManifest("2.0.0-rc.14"),
          failRecordReads: true,
        },
      ],
      cached: {
        manifest: cachedManifest,
        source: { account: "root.near", gateway: "root" },
        provenance: "record",
      },
    });
    const resolved = await h.run({ ...childConfig, release: "2.0.0-rc.14" });
    expect(resolved?.fromCache).toBe(true);
    expect(resolved?.provenance).toBe("record");
    expect(resolved?.manifest.frameworkVersion).toBe("2.0.0-rc.14");
  });

  it("a cache older than the TTL is refused — pin-less resolution degrades to null", async () => {
    const h = harness({
      chain: [],
      cached: {
        manifest: makeManifest("2.0.0-rc.14"),
        source: { account: "root.near", gateway: "root" },
        resolvedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
      },
    });
    expect(await h.run(childConfig)).toBeNull();
  });

  it("a cache older than the TTL is refused — a pinned resolution fails loud", async () => {
    const h = harness({
      chain: [],
      cached: {
        manifest: makeManifest("2.0.0-rc.14"),
        source: { account: "root.near", gateway: "root" },
        resolvedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
      },
    });
    await expect(h.run({ ...childConfig, release: "2.0.0-rc.14" })).rejects.toThrow(
      /2\.0\.0-rc\.14/,
    );
  });

  it("a cache with an unparseable resolvedAt is never trusted", async () => {
    const h = harness({
      chain: [],
      cached: {
        manifest: makeManifest("2.0.0-rc.14"),
        source: { account: "root.near", gateway: "root" },
        resolvedAt: "not-a-date",
      },
    });
    expect(await h.run(childConfig)).toBeNull();
  });

  it("a fresh cache inside the injected clock serves offline resolution", async () => {
    const t0 = 1_900_000_000_000;
    const h = harness({
      chain: [],
      cached: {
        manifest: makeManifest("2.0.0-rc.14"),
        source: { account: "root.near", gateway: "root" },
        resolvedAt: new Date(t0).toISOString(),
      },
      now: () => t0 + 60_000,
    });
    const resolved = await h.run(childConfig);
    expect(resolved?.fromCache).toBe(true);
  });

  it("writes and reads the .bos cache file by default", async () => {
    const h = harness({
      chain: [{ account: "root.near", gateway: "root", manifest: makeManifest("2.0.0-rc.14") }],
      useDefaultCache: true,
    });
    const resolved = await h.run(childConfig);
    expect(resolved).not.toBeNull();
    const cached = JSON.parse(readFileSync(join(tmpRoot, ".bos", "manifest.json"), "utf-8")) as {
      manifest: Manifest;
    };
    expect(cached.manifest.frameworkVersion).toBe("2.0.0-rc.14");
  });
});
