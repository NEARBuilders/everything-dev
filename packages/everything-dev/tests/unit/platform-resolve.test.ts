import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  composePlatformReleaseManifest,
  type PlatformReleaseManifest,
  resolvePlatformManifest,
} from "../../src/services/platform/manifest";

let tmpRoot: string;

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function makeManifest(frameworkVersion: string): PlatformReleaseManifest {
  return composePlatformReleaseManifest({
    frameworkVersion,
    everyPluginVersion: "3.0.0-rc.9",
    imageRef: "ghcr.io/nearbuilders/everything-dev",
    catalog: {},
    templateInventory: [],
    compatMinChild: frameworkVersion,
  });
}

function harness(opts: {
  chain: Array<{
    account: string;
    gateway: string;
    manifest?: PlatformReleaseManifest;
    config?: Record<string, unknown>;
  }>;
  cached?: { manifest: PlatformReleaseManifest; source: { account: string; gateway: string } };
  useDefaultCache?: boolean;
}) {
  const writes: Array<unknown> = [];
  const fetchManifest = async (account: string, gateway: string) =>
    opts.chain.find((n) => n.account === account && n.gateway === gateway)?.manifest ?? null;
  const fetchParent = async (account: string, gateway: string) =>
    opts.chain.find((n) => n.account === account && n.gateway === gateway)?.config ?? null;
  return {
    writes,
    run: (localConfig: Record<string, unknown>) => {
      tmpRoot = mkdtempSync(join(tmpdir(), "platform-resolve-"));
      return resolvePlatformManifest({
        configDir: tmpRoot,
        localConfig,
        fetchManifest,
        fetchParent,
        ...(opts.useDefaultCache
          ? {}
          : {
              cacheRead: () => (opts.cached ? { ...opts.cached, resolvedAt: "2026-01-01" } : null),
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

  it("an exact pin resolves from the chain and caches", async () => {
    const h = harness({
      chain: [
        {
          account: "root.near",
          gateway: "root",
          manifest: makeManifest("2.0.0-rc.14"),
          config: { extends: "bos://mid.near/mid" },
        },
        { account: "mid.near", gateway: "mid", manifest: makeManifest("2.1.0") },
      ],
    });
    const resolved = await h.run({ ...childConfig, platform: "2.1.0" });
    expect(resolved?.manifest.frameworkVersion).toBe("2.1.0");
    expect(resolved?.source).toEqual({ account: "mid.near", gateway: "mid" });
    expect(h.writes).toHaveLength(1);
  });

  it("a pin the chain cannot satisfy fails loud", async () => {
    const h = harness({
      chain: [{ account: "root.near", gateway: "root", manifest: makeManifest("2.0.0-rc.14") }],
    });
    await expect(h.run({ ...childConfig, platform: "9.0.0" })).rejects.toThrow(/9\.0\.0/);
  });

  it("no manifest anywhere → null (today's behavior, ADR 0034 pt 7)", async () => {
    const h = harness({
      chain: [{ account: "root.near", gateway: "root", config: { extends: "bos://a.near/b" } }],
    });
    expect(await h.run(childConfig)).toBeNull();
  });

  it("offline with a cache matching the pin → the cached manifest (fromCache)", async () => {
    const cachedManifest = makeManifest("2.0.0-rc.14");
    const h = harness({
      chain: [],
      cached: { manifest: cachedManifest, source: { account: "root.near", gateway: "root" } },
    });
    const resolved = await h.run({ ...childConfig, platform: "2.0.0-rc.14" });
    expect(resolved?.fromCache).toBe(true);
    expect(resolved?.manifest.frameworkVersion).toBe("2.0.0-rc.14");
  });

  it("writes and reads the .bos cache file by default", async () => {
    const h = harness({
      chain: [{ account: "root.near", gateway: "root", manifest: makeManifest("2.0.0-rc.14") }],
      useDefaultCache: true,
    });
    const resolved = await h.run(childConfig);
    expect(resolved).not.toBeNull();
    const cached = JSON.parse(
      readFileSync(join(tmpRoot, ".bos", "platform-manifest.json"), "utf-8"),
    ) as { manifest: PlatformReleaseManifest };
    expect(cached.manifest.frameworkVersion).toBe("2.0.0-rc.14");
  });
});
