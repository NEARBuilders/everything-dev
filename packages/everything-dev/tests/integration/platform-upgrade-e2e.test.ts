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
  resolveReleaseManifestForDeploy,
  runCompositionGate,
  stampInheritedSlotsFromRelease,
} from "../../src/services/deploy/composition";
import { computeManifestSri } from "../../src/services/deploy/manifest-verify";
import {
  composePlatformManifestPublishEntry,
  deriveImageRefFromPlatformManifest,
  PLATFORM_IMAGE_REF,
  platformTruthViolations,
} from "../../src/services/deploy/platform-manifest";
import { checkUiCompositionCompat } from "../../src/services/federation/service";
import {
  checkPlatformCompat,
  getPlatformVersionSlotKey,
  type PlatformReleaseManifest,
  PlatformReleaseManifestSchema,
  resolvePlatformManifest,
} from "../../src/services/platform/manifest";
import { resolveBootShape } from "../../src/services/resolution/boot-check";
import { applyPlatformPin } from "../../src/services/scaffold/upgrade-migration";
import {
  type ExtendedRootSourceOptions,
  readExtendedRootSource,
} from "../../src/services/scaffold/upgrade-source";
import { versionManifestFetcher, versionManifestText } from "../helpers/version-manifests";

const ROOT_ACCOUNT = "dev.everything.near";
const ROOT_GATEWAY = "everything.dev";
const PLATFORM_KEY = `apps/${ROOT_ACCOUNT}/${ROOT_GATEWAY}/platform.json`;
const CONFIG_KEY = `apps/${ROOT_ACCOUNT}/${ROOT_GATEWAY}/bos.config.json`;

const tempDirs: string[] = [];
const registry = new Map<string, unknown>();
let rootDir: string;
let childDir: string;

/** The fake FastKV: parent-config fetch + platform-manifest fetch + the
 * immutable version-slot fetch (#574). */
const fetchParent = async (account: string, gateway: string) =>
  (registry.get(`apps/${account}/${gateway}/bos.config.json`) as Record<string, unknown>) ?? null;
const fetchManifest = async (account: string, gateway: string) =>
  (registry.get(`apps/${account}/${gateway}/platform.json`) as PlatformReleaseManifest) ?? null;
const fetchSlot = async (account: string, gateway: string, version: string) =>
  registry.get(`apps/${account}/${gateway}/platform-versions/${version}.json`) ?? null;

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
  // the real train's atomic write carries BOTH keys (#573): the immutable
  // version slot + the pointer flip
  registry.set(entry!.key, JSON.parse(entry!.value));
  registry.set(
    getPlatformVersionSlotKey(ROOT_ACCOUNT, ROOT_GATEWAY, entry!.manifest.frameworkVersion),
    JSON.parse(entry!.value),
  );
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
      fetchSlot,
    });
    expect(derived).toEqual({ image: PLATFORM_IMAGE_REF, tag: "v2.0.0-rc.1" });

    const resolved = (await resolvePlatformManifest({
      configDir: childDir,
      localConfig: readChildConfig(),
      fetchManifest,
      fetchParent,
      fetchSlot,
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

  it("R2 — the root publishes vB; the pinned child still resolves vA from the immutable slot (#574)", async () => {
    writeFileSync(
      join(rootDir, "packages", "everything-dev", "package.json"),
      `${JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.2" })}\n`,
    );
    publishRootRelease("2.0.0-rc.1");

    // the pointer flipped to vB, but the child's vA pin resolves from the
    // immutable version slot — no cache needed, no stale-pin grace
    const pinned = await resolvePlatformManifest({
      configDir: childDir,
      localConfig: readChildConfig(),
      fetchManifest,
      fetchParent,
      fetchSlot,
    });
    expect(pinned).not.toBeNull();
    expect(pinned!.manifest.frameworkVersion).toBe("2.0.0-rc.1");
    expect(pinned!.provenance).toBe("slot");
    expect(pinned!.fromCache).toBe(false);
  });

  it("stale fail-loud — a pin whose slot was never published fails with the actionable error (#568 class)", async () => {
    const cacheFile = join(childDir, ".bos", "platform-manifest.json");
    if (existsSync(cacheFile)) rmSync(cacheFile);

    // a version whose manifest leg never published a slot — the release
    // deploy must be re-run (the old "pin not found, publish or clear the
    // pin" dead path is gone)
    await expect(
      resolvePlatformManifest({
        configDir: childDir,
        localConfig: { ...readChildConfig(), platform: "2.0.0-rc.99" },
        fetchManifest,
        fetchParent,
        fetchSlot,
      }),
    ).rejects.toThrow(/never published/);
  });

  it("the cache is an offline aid, not stale-pin grace — an expired cache is irrelevant when the slot resolves", async () => {
    const cacheFile = join(childDir, ".bos", "platform-manifest.json");
    const cache = {
      schemaVersion: 1 as const,
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
      provenance: "slot" as const,
    };
    writeFileSync(cacheFile, `${JSON.stringify(cache)}\n`);

    // past the TTL, pinned resolution ignores the cache entirely — the
    // immutable slot serves the pin (permanent resolution)
    await expect(
      resolvePlatformManifest({
        configDir: childDir,
        localConfig: readChildConfig(),
        fetchManifest,
        fetchParent,
        fetchSlot,
        now: () => Date.now() + 25 * 60 * 60_000,
      }),
    ).resolves.toMatchObject({
      provenance: "slot",
      fromCache: false,
      manifest: { frameworkVersion: "2.0.0-rc.1" },
    });

    // inside the TTL with the slot reads failing (offline dev), the cache
    // stands in
    await expect(
      resolvePlatformManifest({
        configDir: childDir,
        localConfig: readChildConfig(),
        fetchManifest,
        fetchParent,
        fetchSlot: async () => {
          throw new Error("registry unreachable");
        },
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
        fetchSlot,
      });
    } catch {
      const latest = await resolvePlatformManifest({
        configDir: childDir,
        localConfig: { ...localConfig, platform: undefined },
        fetchManifest,
        fetchParent,
        fetchSlot,
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
    // rc-aware compat (plan 057): the pinned child 2.0.0-rc.1 now also fails
    // the release's 2.0.0-rc.2 compat floor — the old comparator could not
    // order prereleases and let this pass silently.
    expect(violations).toHaveLength(2);
    const skew = violations.find((v) => v.kind === "shared-dep");
    expect(skew).toMatchObject({ kind: "shared-dep", name: "react" });
    expect(skew!.message).toContain("the release pins 19.3.0");
    expect(violations.some((v) => v.kind === "minChild")).toBe(true);
  });
});

/**
 * Release-scoped extends inheritance (ADR 0034 amendment) — the incident
 * replay on the deploy train's composition plane:
 *
 *   The root publishes rc.1 (its release manifest records the auth slot
 *   pins), then rc.2 whose LIVE config moves the inherited auth slots to
 *   react 19.3.0. A child pinned rc.1 — its own ui built against react
 *   19.2.4 — deploys: the train stamps app.auth/app.auth.ui from the rc.1
 *   release's slots map, the extends-merged shape composes rc.1 auth against
 *   rc.1 ui, and the composition gate is green. The same deploy WITHOUT the
 *   stamps (a pre-slots release) composes live rc.2 auth against rc.1 ui —
 *   the #546 skew — and the gate blocks publish with the remediation named.
 */
describe("release-scoped inheritance — a pinned child deploy survives the root's newer publish", () => {
  const ACCOUNT = "root.near";
  const GATEWAY = "root";
  const CHILD_SLOT = { account: "child.near", gateway: "child.example" };
  const liveConfigKey = `apps/${ACCOUNT}/${GATEWAY}/bos.config.json`;

  const authRc1Shared = { "everything-dev/ui/auth": "2.0.0-rc.1", react: "19.2.4" };
  const authRc2Shared = { "everything-dev/ui/auth": "2.0.0-rc.2", react: "19.3.0" };
  const childUiShared = { react: "19.2.4" };

  let server: Server;
  let base: string;
  let routes: Record<string, string>;
  let rootDir: string;
  let childDir: string;

  const pinFor = (slotBase: string, file: string, shared: Record<string, string>) => {
    const text = versionManifestText(shared);
    routes[`${base}${slotBase}${file}`] = text;
    return { manifest: file, integrity: computeManifestSri(text) };
  };

  const registryIo = {
    fetchBosConfig: async (bosUrl: string) => {
      const [account, gateway] = bosUrl.replace(/^bos:\/\//, "").split("/");
      const entry = registry.get(`apps/${account}/${gateway}/bos.config.json`);
      if (!entry) throw new Error(`No config found for ${bosUrl}`);
      return entry;
    },
    readFileOrNull: async () => null,
    importModule: async () => {
      throw new Error("importModule must not be reached");
    },
  };

  /** The root's release compose: the release manifest records its slot pins,
   * and the live parent config carries the same pins — the moving pointer the
   * incident trips over. Each release's live auth slots carry that release's
   * shared-singleton versions (rc.1: react 19.2.4; rc.2: 19.3.0). */
  function publishRootRelease(
    version: string,
    previousVersion: string | undefined,
    shared: Record<string, string>,
  ): PlatformReleaseManifest {
    writeFileSync(
      join(rootDir, "packages", "everything-dev", "package.json"),
      `${JSON.stringify({ name: "everything-dev", version })}\n`,
    );
    const authPin = pinFor("/auth/", `versions/auth-${version}.json`, shared);
    const authUiPin = pinFor("/auth-ui/", `versions/auth-ui-${version}.json`, shared);
    const entry = composePlatformManifestPublishEntry({
      configDir: rootDir,
      account: ACCOUNT,
      gateway: GATEWAY,
      ...(previousVersion ? { previousFrameworkVersion: previousVersion } : {}),
      publishPayload: {
        app: {
          auth: {
            production: `${base}/auth/`,
            pin: authPin,
            ui: { production: `${base}/auth-ui/`, pin: authUiPin },
          },
        },
      },
    });
    expect(entry).not.toBeNull();
    registry.set(entry!.key, JSON.parse(entry!.value));
    registry.set(getPlatformVersionSlotKey(ACCOUNT, GATEWAY, version), JSON.parse(entry!.value));
    registry.set(liveConfigKey, {
      account: ACCOUNT,
      domain: GATEWAY,
      app: {
        auth: {
          production: `${base}/auth/`,
          pin: authPin,
          ui: { production: `${base}/auth-ui/`, pin: authUiPin },
        },
      },
    });
    return entry!.manifest;
  }

  /** The deploy train's payload assembly, compressed: authored config, the
   * train-applied own-ui pin, optional stamps, one boot walk, then the gate. */
  async function simulateDeploy(
    authoredConfig: Record<string, unknown>,
    ownUiPin: { manifest: string; integrity: string },
    stamps: boolean,
  ): Promise<{ ok: boolean; violations: string[]; merged: Record<string, unknown> }> {
    const resolvedRelease = await resolveReleaseManifestForDeploy({
      configDir: childDir,
      authoredConfig,
      resolveOptions: { fetchManifest, fetchParent, fetchSlot },
    });
    const payload = structuredClone(authoredConfig);
    const app = payload.app as Record<string, Record<string, unknown>>;
    app.ui.production = `${base}/child-ui/`;
    app.ui.pin = ownUiPin;
    if (stamps && resolvedRelease?.slots) {
      stampInheritedSlotsFromRelease({
        payload,
        authoredConfig,
        manifest: resolvedRelease,
      });
    }
    const bootShape = await resolveBootShape(payload, CHILD_SLOT, { io: registryIo });
    const gate = await runCompositionGate({
      configDir: childDir,
      authoredConfig,
      resolvedShape: bootShape.config as Record<string, unknown>,
      resolvedRelease,
      fetchImpl: versionManifestFetcher(routes),
    });
    return {
      ok: gate.ok,
      violations: gate.violations,
      merged: bootShape.config as Record<string, unknown>,
    };
  }

  beforeAll(async () => {
    routes = {};
    server = createServer((req, res) => {
      const text = routes[req.url ?? ""];
      res.writeHead(text !== undefined ? 200 : 404, { "content-type": "application/json" });
      res.end(text ?? "");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no server address");
    base = `http://127.0.0.1:${address.port}`;

    routes[`${base}/child-ui/versions/fedcba0987654321.json`] = versionManifestText(childUiShared);

    rootDir = frameworkRootFixture("2.0.0-rc.1", "19.2.4");
    childDir = childFixture("2.0.0-rc.1");
    writeFileSync(
      join(childDir, "package.json"),
      `${JSON.stringify({ name: "child", dependencies: { "everything-dev": "2.0.0-rc.1" } })}\n`,
    );
    writeFileSync(
      join(childDir, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - ui",
        "",
        "catalog:",
        '  react: "19.2.4"',
        '  effect: "4.0.0-rc.112"',
        "",
      ].join("\n"),
    );

    publishRootRelease("2.0.0-rc.1", undefined, authRc1Shared);
    publishRootRelease("2.0.0-rc.2", "2.0.0-rc.1", authRc2Shared);
  });

  afterAll(() => {
    server.close();
    for (const dir of tempDirs.splice(-2)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the child deploy stamps inherited auth slots from its pinned release — the composition gate is green", async () => {
    const authoredConfig = {
      extends: `bos://${ACCOUNT}/${GATEWAY}`,
      account: "child.near",
      domain: "child.example",
      platform: "2.0.0-rc.1",
      app: { ui: { development: "local:ui" } },
    };
    const { ok, violations, merged } = await simulateDeploy(
      authoredConfig,
      {
        manifest: "versions/fedcba0987654321.json",
        integrity: computeManifestSri(versionManifestText(childUiShared)),
      },
      true,
    );
    expect(violations).toEqual([]);

    const app = merged.app as Record<string, Record<string, Record<string, string>>>;
    expect(app.auth.pin.manifest).toBe("versions/auth-2.0.0-rc.1.json");
    expect(app.auth.ui.pin.manifest).toBe("versions/auth-ui-2.0.0-rc.1.json");
    expect(ok).toBe(true);
  });

  it("without the stamps (a pre-slots release) the deploy gate blocks with the #546 skew and the remediation", async () => {
    const authoredConfig = {
      extends: `bos://${ACCOUNT}/${GATEWAY}`,
      account: "child.near",
      domain: "child.example",
      platform: "2.0.0-rc.1",
      app: { ui: { development: "local:ui" } },
    };
    const { ok, violations } = await simulateDeploy(
      authoredConfig,
      {
        manifest: "versions/fedcba0987654321.json",
        integrity: computeManifestSri(versionManifestText(childUiShared)),
      },
      false,
    );
    expect(ok).toBe(false);
    const combined = violations.join("\n");
    expect(combined).toContain("Shared singleton");
    expect(combined).toContain("19.2.4");
    expect(combined).toContain("19.3.0");
    expect(combined).toContain("bos upgrade");
  });
});
