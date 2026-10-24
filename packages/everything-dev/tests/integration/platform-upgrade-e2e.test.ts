/**
 * Platform upgrade e2e (ADR 0034) — the full manifest lifecycle on an
 * in-memory FastKV registry, no network, no spawns:
 *
 *   R1 root publishes vA → C1 child upgrade pins vA → C-deploy derives the
 *   image pin → R2 root publishes vB (pinned child still resolves vA through
 *   the fresh 24h cache) → stale fail-loud (cache deleted / TTL expired, pin
 *   unresolvable) → C2 upgrade ignores the pin, re-pins the latest release →
 *   #546 replay (drifted-react republish: the composition gate names the
 *   skewed slots, `bos platform manifest --check` flags the drift).
 *
 * The deploy legs are proxies for the real train: composition of the
 * platform.json registry entry (the publish half) and the derived image
 * `ref@v<version>` pin plus the publish-train truth gate (the deploy half).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composePlatformManifestPublishEntry,
  deriveImageRefFromPlatformManifest,
  PLATFORM_IMAGE_REF,
  platformTruthViolations,
} from "../../src/services/deploy/platform-manifest";
import { checkUiCompositionCompat } from "../../src/services/federation/service";
import {
  checkPlatformCompat,
  type PlatformReleaseManifest,
  PlatformReleaseManifestSchema,
  resolvePlatformManifest,
} from "../../src/services/platform/manifest";
import { applyPlatformPin } from "../../src/services/scaffold/upgrade-migration";
import {
  type ExtendedRootSourceOptions,
  readExtendedRootSource,
} from "../../src/services/scaffold/upgrade-source";

const ROOT_ACCOUNT = "dev.everything.near";
const ROOT_GATEWAY = "everything.dev";
const PLATFORM_KEY = `apps/${ROOT_ACCOUNT}/${ROOT_GATEWAY}/platform.json`;
const CONFIG_KEY = `apps/${ROOT_ACCOUNT}/${ROOT_GATEWAY}/bos.config.json`;

const tempDirs: string[] = [];
const registry = new Map<string, unknown>();
let rootDir: string;
let childDir: string;

/** The fake FastKV: parent-config fetch + platform-manifest fetch. */
const fetchParent = async (account: string, gateway: string) =>
  (registry.get(`apps/${account}/${gateway}/bos.config.json`) as Record<string, unknown>) ?? null;
const fetchManifest = async (account: string, gateway: string) =>
  (registry.get(`apps/${account}/${gateway}/platform.json`) as PlatformReleaseManifest) ?? null;

function frameworkRootFixture(version: string, reactVersion: string): string {
  const dir = mkdtempSync(join(tmpdir(), "platform-e2e-root-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "packages", "everything-dev"), { recursive: true });
  mkdirSync(join(dir, "packages", "every-plugin"), { recursive: true });
  writeFileSync(
    join(dir, "packages", "everything-dev", "package.json"),
    `${JSON.stringify({ name: "everything-dev", version })}\n`,
  );
  writeFileSync(
    join(dir, "packages", "every-plugin", "package.json"),
    `${JSON.stringify({ name: "every-plugin", version: "3.0.0-rc.9" })}\n`,
  );
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - packages/*",
      "",
      "catalog:",
      `  react: "${reactVersion}"`,
      '  effect: "4.0.0-rc.112"',
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "package.json"), "{}\n");
  return dir;
}

function childFixture(platform?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "platform-e2e-child-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "ui"), { recursive: true });
  writeFileSync(
    join(dir, "bos.config.json"),
    `${JSON.stringify({
      extends: `bos://${ROOT_ACCOUNT}/${ROOT_GATEWAY}`,
      account: "child.near",
      domain: "child.example",
      ...(platform ? { platform } : {}),
      app: { ui: { development: "local:ui" } },
    })}\n`,
  );
  return dir;
}

/** The root's publish train, compressed: compose the release manifest from
 * the fixture tree and write both registry keys (the manifest rides the same
 * atomic FastKV write as the config in the real train). */
function publishRootRelease(previousVersion?: string): PlatformReleaseManifest {
  const entry = composePlatformManifestPublishEntry({
    configDir: rootDir,
    account: ROOT_ACCOUNT,
    gateway: ROOT_GATEWAY,
    ...(previousVersion ? { previousFrameworkVersion: previousVersion } : {}),
  });
  expect(entry).not.toBeNull();
  registry.set(entry!.key, JSON.parse(entry!.value));
  registry.set(CONFIG_KEY, {
    repository: "https://github.com/NEARBuilders/everything-dev",
  });
  return entry!.manifest;
}

function readChildConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(childDir, "bos.config.json"), "utf-8")) as Record<
    string,
    unknown
  >;
}

const upgradeSourceOptions: ExtendedRootSourceOptions = { fetchManifest, fetchParent };

describe("platform upgrade e2e — publish, pin, stale, re-pin, skew", () => {
  beforeAll(() => {
    rootDir = frameworkRootFixture("2.0.0-rc.1", "19.2.4");
    childDir = childFixture();
  });

  afterAll(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    registry.clear();
  });

  it("R1 — the root publishes release vA as a registry entry", () => {
    const manifest = publishRootRelease();
    expect(manifest.frameworkVersion).toBe("2.0.0-rc.1");
    expect(manifest.image.ref).toBe(PLATFORM_IMAGE_REF);
    expect(manifest.image.tags).toEqual(["v2.0.0-rc.1"]);
    expect(registry.get(PLATFORM_KEY)).toMatchObject({ frameworkVersion: "2.0.0-rc.1" });
    expect(registry.get(CONFIG_KEY)).toMatchObject({
      repository: "https://github.com/NEARBuilders/everything-dev",
    });
  });

  it("C1 — the child upgrade resolves the chain and stamps the vA pin", async () => {
    const source = await readExtendedRootSource(childDir, upgradeSourceOptions);
    expect(source.platform.manifest.frameworkVersion).toBe("2.0.0-rc.1");
    expect(source.catalog.react).toBe("19.2.4");
    expect(source.extendsChain).toEqual([`bos://${ROOT_ACCOUNT}/${ROOT_GATEWAY}`]);
    expect(source.repository).toBe("https://github.com/NEARBuilders/everything-dev");

    const stampedFile = await applyPlatformPin(childDir, source);
    expect(stampedFile).toBe("bos.config.json");
    expect(readChildConfig().platform).toBe("2.0.0-rc.1");
  });

  it("C-deploy — the child's image pin derives from the manifest, the truth gate stays silent", async () => {
    const derived = await deriveImageRefFromPlatformManifest({
      configDir: childDir,
      localConfig: readChildConfig(),
      fetchManifest,
      fetchParent,
    });
    expect(derived).toEqual({ image: PLATFORM_IMAGE_REF, tag: "v2.0.0-rc.1" });

    const resolved = (await resolvePlatformManifest({
      configDir: childDir,
      localConfig: readChildConfig(),
      fetchManifest,
      fetchParent,
    }))!;
    expect(resolved.fromCache).toBe(false);
    expect(resolved.source).toEqual({ account: ROOT_ACCOUNT, gateway: ROOT_GATEWAY });

    expect(
      platformTruthViolations(
        resolved.manifest,
        new Map([
          ["app", { react: "19.2.4" }],
          ["app-ui", { react: "19.2.4" }],
        ]),
      ),
    ).toEqual([]);

    const violations = platformTruthViolations(
      resolved.manifest,
      new Map([["app", { react: "18.3.1" }]]),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("the release manifest pins 19.2.4");
  });

  it("R2 — the root publishes vB; the pinned child still resolves vA through the fresh cache", async () => {
    writeFileSync(
      join(rootDir, "packages", "everything-dev", "package.json"),
      `${JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.2" })}\n`,
    );
    publishRootRelease("2.0.0-rc.1");

    const pinned = await resolvePlatformManifest({
      configDir: childDir,
      localConfig: readChildConfig(),
      fetchManifest,
      fetchParent,
    });
    expect(pinned).not.toBeNull();
    expect(pinned!.manifest.frameworkVersion).toBe("2.0.0-rc.1");
    expect(pinned!.fromCache).toBe(true);
  });

  it("stale fail-loud — the pin unresolvable once the cache is deleted (issue #546 decision: assert as-is)", async () => {
    const cacheFile = join(childDir, ".bos", "platform-manifest.json");
    expect(existsSync(cacheFile)).toBe(true);
    rmSync(cacheFile);

    await expect(
      resolvePlatformManifest({
        configDir: childDir,
        localConfig: readChildConfig(),
        fetchManifest,
        fetchParent,
      }),
    ).rejects.toThrow(/platform pin 2\.0\.0-rc\.1 not found in the extends chain/);
  });

  it("stale fail-loud — a fresh cache is refused past the TTL", async () => {
    const cacheFile = join(childDir, ".bos", "platform-manifest.json");
    const cache: {
      schemaVersion: 1;
      kind: "everything-dev/platform-manifest-cache";
      resolvedAt: string;
      source: { account: string; gateway: string };
      manifest: PlatformReleaseManifest;
    } = {
      schemaVersion: 1,
      kind: "everything-dev/platform-manifest-cache",
      resolvedAt: new Date().toISOString(),
      source: { account: ROOT_ACCOUNT, gateway: ROOT_GATEWAY },
      manifest: PlatformReleaseManifestSchema.parse({
        schemaVersion: 1,
        kind: "everything-dev/platform-manifest",
        frameworkVersion: "2.0.0-rc.1",
        everyPluginVersion: "3.0.0-rc.9",
        image: { ref: PLATFORM_IMAGE_REF, tags: ["v2.0.0-rc.1"] },
        catalog: { react: "19.2.4", effect: "4.0.0-rc.112" },
        sharedDeps: {},
        templateInventory: [],
        compat: { minChild: "2.0.0-rc.1" },
      }),
    };
    writeFileSync(cacheFile, `${JSON.stringify(cache)}\n`);

    await expect(
      resolvePlatformManifest({
        configDir: childDir,
        localConfig: readChildConfig(),
        fetchManifest,
        fetchParent,
        now: () => Date.now() + 25 * 60 * 60_000,
      }),
    ).rejects.toThrow(/platform pin 2\.0\.0-rc\.1 not found/);

    await expect(
      resolvePlatformManifest({
        configDir: childDir,
        localConfig: readChildConfig(),
        fetchManifest,
        fetchParent,
        now: () => Date.now() + 23 * 60 * 60_000,
      }),
    ).resolves.toMatchObject({ fromCache: true, manifest: { frameworkVersion: "2.0.0-rc.1" } });
  });

  it("C2 — the upgrade ignores the pin, resolves the latest release, and re-pins", async () => {
    writeFileSync(
      join(rootDir, "packages", "everything-dev", "package.json"),
      `${JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.3" })}\n`,
    );
    writeFileSync(
      join(rootDir, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - packages/*",
        "",
        "catalog:",
        '  react: "19.3.0"',
        '  effect: "4.0.0-rc.112"',
        "",
      ].join("\n"),
    );
    publishRootRelease("2.0.0-rc.2");

    const source = await readExtendedRootSource(childDir, upgradeSourceOptions);
    expect(source.platform.manifest.frameworkVersion).toBe("2.0.0-rc.3");
    expect(source.catalog.react).toBe("19.3.0");

    await applyPlatformPin(childDir, source);
    expect(readChildConfig().platform).toBe("2.0.0-rc.3");
  });
});

describe("#546 replay — drifted-react republish after the child stayed pinned", () => {
  /** The child's ui bundle still builds against react 19.2.4 while the
   * root's published ui slot serves 19.3.0 — the composition negotiation
   * fails with the federation runtime's cryptic error at `mf.loadRemote`.
   * The host boot guard raises SharedSingletonSkewError; here the same skew
   * surfaces through the two pre-flight mirrors. */
  let server: Server;
  let baseUrl: string;
  let childDir: string;

  beforeAll(async () => {
    childDir = mkdtempSync(join(tmpdir(), "platform-e2e-skew-"));
    server = createServer((req, res) => {
      const manifests: Record<string, unknown> = {
        "/root-ui-manifest.json": { shared: [{ name: "react", version: "19.3.0" }] },
        "/child-ui-manifest.json": { shared: [{ name: "react", version: "19.2.4" }] },
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(manifests[req.url ?? ""] ?? {}));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no server address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    writeFileSync(
      join(childDir, "bos.config.json"),
      `${JSON.stringify({
        extends: `bos://${ROOT_ACCOUNT}/${ROOT_GATEWAY}`,
        account: "child.near",
        domain: "child.example",
        platform: "2.0.0-rc.1",
        app: { ui: { production: `${baseUrl}/root-ui-manifest.json` } },
        plugins: {
          votes: { ui: { production: `${baseUrl}/child-ui-manifest.json` } },
        },
      })}\n`,
    );
    registry.set(
      PLATFORM_KEY,
      PlatformReleaseManifestSchema.parse({
        schemaVersion: 1,
        kind: "everything-dev/platform-manifest",
        frameworkVersion: "2.0.0-rc.3",
        everyPluginVersion: "3.0.0-rc.9",
        image: { ref: PLATFORM_IMAGE_REF, tags: ["v2.0.0-rc.3"] },
        catalog: { react: "19.3.0", effect: "4.0.0-rc.112" },
        sharedDeps: {
          react: {
            version: "19.3.0",
            requiredVersion: "19.3.0",
            singleton: true,
            eager: false,
            strictVersion: true,
            shareScope: "default",
          },
        },
        templateInventory: [],
        compat: { minChild: "2.0.0-rc.2" },
      }),
    );
  });

  afterAll(() => {
    server.close();
    registry.delete(PLATFORM_KEY);
    rmSync(childDir, { recursive: true, force: true });
  });

  it("mf check's ui gate names the skewed slots and versions", async () => {
    const config = JSON.parse(readFileSync(join(childDir, "bos.config.json"), "utf-8"));
    const report = await checkUiCompositionCompat(config);
    expect(report.ok).toBe(false);
    const rootSlot = report.slots.find((slot) => slot.slot === "app.ui")!;
    const childSlot = report.slots.find((slot) => slot.slot === "plugins.votes.ui")!;
    expect(rootSlot.reachable).toBe(true);
    expect(childSlot.reachable).toBe(true);
    expect(rootSlot.ok).toBe(false);
    expect(childSlot.ok).toBe(false);
    expect(rootSlot.reason).toContain("react");
    expect(rootSlot.reason).toContain("19.2.4");
    expect(rootSlot.reason).toContain("19.3.0");
  });

  it("platform manifest --check flags the pin drift and the compat skew", async () => {
    const localConfig = JSON.parse(
      readFileSync(join(childDir, "bos.config.json"), "utf-8"),
    ) as Record<string, unknown>;

    let resolved: Awaited<ReturnType<typeof resolvePlatformManifest>>;
    let drift: { pinned: string; published: string } | undefined;
    try {
      resolved = await resolvePlatformManifest({
        configDir: childDir,
        localConfig,
        fetchManifest,
        fetchParent,
      });
    } catch {
      const latest = await resolvePlatformManifest({
        configDir: childDir,
        localConfig: { ...localConfig, platform: undefined },
        fetchManifest,
        fetchParent,
      });
      resolved = latest;
      const pinned = typeof localConfig.platform === "string" ? localConfig.platform : undefined;
      drift = pinned ? { pinned, published: latest!.manifest.frameworkVersion } : undefined;
    }
    expect(resolved).not.toBeNull();
    expect(drift).toEqual({ pinned: "2.0.0-rc.1", published: "2.0.0-rc.3" });

    const violations = checkPlatformCompat(resolved!.manifest, {
      platformVersion: drift!.pinned,
      catalog: { react: "19.2.4", effect: "4.0.0-rc.112" },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: "shared-dep", name: "react" });
    expect(violations[0]!.message).toContain("the release pins 19.3.0");
  });
});
