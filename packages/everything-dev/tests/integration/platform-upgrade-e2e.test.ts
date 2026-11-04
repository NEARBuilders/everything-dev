/**
 * Platform upgrade e2e (ADR 0034) — the full manifest lifecycle on an
 * in-memory FastKV registry, no network, no spawns:
 *
 *   R1 root publishes vA → C1 child upgrade pins vA → C-deploy derives the
 *   image pin → R2 root publishes vB (pinned child still resolves vA through
 *   the fresh 24h cache) → stale fail-loud (cache deleted / TTL expired, pin
 *   unresolvable) → C2 upgrade ignores the pin, re-pins the latest release →
 *   #546 replay (drifted-react republish: the composition gate names the
 *   skewed slots, `bos platform manifest --check` flags the drift) → the
 *   mixed-tree replay (a caret-authored root publishes exact catalog rows,
 *   the child upgrade consumes them verbatim, a drifted install fails loud).
 *
 * The deploy legs are proxies for the real train: composition of the
 * platform.json registry entry (the publish half) and the derived image
 * `ref@v<version>` pin plus the publish-train truth gate (the deploy half).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { upgradeTemplate } from "../../src/cli/upgrade";
import {
  resolveReleaseManifestForDeploy,
  runCompositionGate,
  stampRemotesFromRelease,
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
  type Manifest,
  ManifestSchema,
  resolvePlatformManifest,
} from "../../src/services/platform/manifest";
import { parseRuntimeRef } from "../../src/services/registry/keys";
import { getVersionKey } from "../../src/services/registry/pointer";
import * as resolutionModule from "../../src/services/registry/resolution";
import {
  resolveBootShape,
  verifyResolvedBootShape,
} from "../../src/services/resolution/boot-check";
import * as initSourceModule from "../../src/services/resolution/init-source";
import * as sessionModule from "../../src/services/resolution/session";
import * as initModule from "../../src/services/scaffold/init";
import * as syncModule from "../../src/services/scaffold/sync";
import { applyRelease } from "../../src/services/scaffold/upgrade-migration";
import { installDriftError } from "../../src/services/scaffold/upgrade-packages";
import {
  type ExtendedRootSourceOptions,
  readExtendedRootSource,
} from "../../src/services/scaffold/upgrade-source";
import { readWorkspaceCatalog } from "../../src/services/workspace/catalog";
import * as sharedDepsModule from "../../src/services/workspace/shared-deps";
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
  (registry.get(`apps/${account}/${gateway}/platform.json`) as Manifest) ?? null;
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

function childFixture(release?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "platform-e2e-child-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "ui"), { recursive: true });
  writeFileSync(
    join(dir, "bos.config.json"),
    `${JSON.stringify({
      extends: `bos://${ROOT_ACCOUNT}/${ROOT_GATEWAY}`,
      account: "child.near",
      domain: "child.example",
      ...(release ? { release } : {}),
      app: { ui: { development: "local:ui" } },
    })}\n`,
  );
  return dir;
}

/** The root's publish train, compressed: compose the release manifest from
 * the fixture tree and write both registry keys (the manifest rides the same
 * atomic FastKV write as the config in the real train). */
function publishRootRelease(previousVersion?: string): Manifest {
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
    getVersionKey(ROOT_ACCOUNT, ROOT_GATEWAY, entry!.manifest.frameworkVersion),
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

/** The upgrade-source seams over the fake FastKV: the resolution machine's
 * tag/record reads point at the registry map; the cache read is forced-miss
 * inside readExtendedRootSource (policy — not overridable). */
const upgradeSourceOptions: ExtendedRootSourceOptions = {
  fetchParent,
  seams: {
    async readManifestTag(ref) {
      const { accountId, gatewayId } = parseRuntimeRef(ref);
      return (registry.get(`apps/${accountId}/${gatewayId}/platform.json`) as unknown) ?? null;
    },
    async readVersionRecord(ref, release) {
      const { accountId, gatewayId } = parseRuntimeRef(ref);
      const value = registry.get(
        `apps/${accountId}/${gatewayId}/platform-versions/${release}.json`,
      );
      return value === undefined ? null : JSON.stringify(value);
    },
    parseManifest: (value) => ManifestSchema.parse(value),
  },
};

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

  it("C1 — the child upgrade resolves the chain and stamps the release", async () => {
    const source = await readExtendedRootSource(childDir, upgradeSourceOptions);
    expect(source.platform.manifest.frameworkVersion).toBe("2.0.0-rc.1");
    expect(source.catalog.react).toBe("19.2.4");
    expect(source.extendsChain).toEqual([`bos://${ROOT_ACCOUNT}/${ROOT_GATEWAY}`]);
    expect(source.repository).toBe("https://github.com/NEARBuilders/everything-dev");

    const stampedFile = await applyRelease(childDir, source);
    expect(stampedFile).toBe("bos.config.json");
    expect(readChildConfig().release).toBe("2.0.0-rc.1");
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
    const cacheFile = join(childDir, ".bos", "manifest.json");
    if (existsSync(cacheFile)) rmSync(cacheFile);

    // a version whose manifest leg never published a slot — the release
    // deploy must be re-run (the old "pin not found, publish or clear the
    // pin" dead path is gone)
    await expect(
      resolvePlatformManifest({
        configDir: childDir,
        localConfig: { ...readChildConfig(), release: "2.0.0-rc.99" },
        fetchManifest,
        fetchParent,
        fetchSlot,
      }),
    ).rejects.toThrow(/never published/);
  });

  it("the cache is an offline aid, not stale-pin grace — an expired cache is irrelevant when the slot resolves", async () => {
    const cacheFile = join(childDir, ".bos", "manifest.json");
    const cache = {
      schemaVersion: 1 as const,
      kind: "everything-dev/platform-manifest-cache",
      resolvedAt: new Date().toISOString(),
      source: { account: ROOT_ACCOUNT, gateway: ROOT_GATEWAY },
      manifest: ManifestSchema.parse({
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

  it("C2 — the upgrade ignores the authored release, resolves the latest release, and re-stamps", async () => {
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

    await applyRelease(childDir, source);
    expect(readChildConfig().release).toBe("2.0.0-rc.3");
  });

  it("the incident replay — an authored release whose version record is absent never blocks the upgrade", async () => {
    // the Nov-03 burned slot: the child is aligned to a release the chain
    // never recorded. Everyday resolution fails loud on it; the upgrade —
    // the sanctioned repair — must resolve latest and move the tree anyway.
    writeFileSync(
      join(childDir, "bos.config.json"),
      `${JSON.stringify({
        extends: `bos://${ROOT_ACCOUNT}/${ROOT_GATEWAY}`,
        account: "child.near",
        domain: "child.example",
        release: "2.0.0-rc.99",
        app: { ui: { development: "local:ui" } },
      })}\n`,
    );

    const source = await readExtendedRootSource(childDir, upgradeSourceOptions);
    expect(source.authoredRelease).toBe("2.0.0-rc.99");
    expect(source.platform.manifest.frameworkVersion).toBe("2.0.0-rc.3");

    await applyRelease(childDir, source);
    const config = readChildConfig();
    expect(config.release).toBe("2.0.0-rc.3");
    expect(config.platform).toBeUndefined();
  });

  it("the codemod — a legacy platform key rewrites to the release field in the same stamp", async () => {
    writeFileSync(
      join(childDir, "bos.config.json"),
      `${JSON.stringify({
        extends: `bos://${ROOT_ACCOUNT}/${ROOT_GATEWAY}`,
        account: "child.near",
        domain: "child.example",
        platform: "2.0.0-rc.99",
        app: { ui: { development: "local:ui" } },
      })}\n`,
    );

    const source = await readExtendedRootSource(childDir, upgradeSourceOptions);
    await applyRelease(childDir, source);
    const config = readChildConfig();
    expect(config.release).toBe("2.0.0-rc.3");
    expect(config.platform).toBeUndefined();
  });

  it("cache refusal — the upgrade-of-record never chooses a release from the offline cache", async () => {
    // a fresh cache stands in on the child (the offline-dev aid) while the
    // registry goes dark — the upgrade refuses instead of stamping stale bytes
    const cacheFile = join(childDir, ".bos", "manifest.json");
    mkdirSync(join(childDir, ".bos"), { recursive: true });
    writeFileSync(
      cacheFile,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "everything-dev/platform-manifest-cache",
        resolvedAt: new Date().toISOString(),
        source: { account: ROOT_ACCOUNT, gateway: ROOT_GATEWAY },
        manifest: ManifestSchema.parse({
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
        provenance: "slot",
      })}\n`,
    );

    const darkSeams: ExtendedRootSourceOptions = {
      fetchParent,
      seams: {
        readManifestTag: async () => null,
        readVersionRecord: async () => null,
        parseManifest: (value) => ManifestSchema.parse(value),
      },
    };
    await expect(readExtendedRootSource(childDir, darkSeams)).rejects.toThrow(
      /No platform release manifest resolves/,
    );
    // and the cache file was never the excuse — it is untouched on disk
    expect(existsSync(cacheFile)).toBe(true);
    rmSync(cacheFile, { force: true });
  });

  it("stamp refusal — a release whose version record never published fails before any mutation (#568)", async () => {
    // the root's deploy flipped the tag to rc.4 but its manifest leg never
    // wrote the version record — the upgrade refuses at the source, with the
    // child's authored config untouched
    writeFileSync(
      join(rootDir, "packages", "everything-dev", "package.json"),
      `${JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.4" })}\n`,
    );
    const entry = composePlatformManifestPublishEntry({
      configDir: rootDir,
      account: ROOT_ACCOUNT,
      gateway: ROOT_GATEWAY,
      previousFrameworkVersion: "2.0.0-rc.3",
    });
    expect(entry).not.toBeNull();
    registry.set(entry!.key, JSON.parse(entry!.value));

    const before = readFileSync(join(childDir, "bos.config.json"), "utf-8");
    await expect(readExtendedRootSource(childDir, upgradeSourceOptions)).rejects.toThrow(
      /version record is not published/,
    );
    expect(readFileSync(join(childDir, "bos.config.json"), "utf-8")).toBe(before);
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
        release: "2.0.0-rc.1",
        app: { ui: { production: `${baseUrl}/root-ui-manifest.json` } },
        plugins: {
          votes: { ui: { production: `${baseUrl}/child-ui-manifest.json` } },
        },
      })}\n`,
    );
    registry.set(
      PLATFORM_KEY,
      ManifestSchema.parse({
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
        localConfig: { ...localConfig, release: undefined },
        fetchManifest,
        fetchParent,
        fetchSlot,
      });
      resolved = latest;
      const pinned = typeof localConfig.release === "string" ? localConfig.release : undefined;
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
  ): Manifest {
    writeFileSync(
      join(rootDir, "packages", "everything-dev", "package.json"),
      `${JSON.stringify({ name: "everything-dev", version })}\n`,
    );
    const authPin = pinFor("/auth/", `versions/auth-${version}.json`, shared);
    const authUiPin = pinFor("/auth-ui/", `versions/auth-ui-${version}.json`, shared);
    const parentUi = { production: `${base}/auth-ui/`, pin: authUiPin, name: "auth" };
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
            ui: parentUi,
          },
        },
        plugins: {
          votes: {
            production: `${base}/votes/`,
            pin: pinFor("/votes/", `versions/votes-${version}.json`, shared),
            ui: {
              production: `${base}/votes-ui/`,
              pin: pinFor("/votes-ui/", `versions/votes-ui-${version}.json`, shared),
              name: "votes-ui",
            },
          },
        },
      },
    });
    expect(entry).not.toBeNull();
    registry.set(entry!.key, JSON.parse(entry!.value));
    registry.set(getVersionKey(ACCOUNT, GATEWAY, version), JSON.parse(entry!.value));
    registry.set(liveConfigKey, {
      account: ACCOUNT,
      domain: GATEWAY,
      app: {
        host: { production: `${base}/host/` },
        ui: { production: `${base}/ui/` },
        api: { production: `${base}/api/` },
        auth: {
          production: `${base}/auth/`,
          pin: authPin,
          ui: parentUi,
        },
      },
    });
    return entry!.manifest;
  }

  /** The deploy train's payload assembly, compressed: authored config, the
   * train-applied own-ui pin, optional stamps, one boot walk, the boot-check
   * schema parse of the merged shape, then the gate. */
  async function simulateDeploy(
    authoredConfig: Record<string, unknown>,
    ownUiPin: { manifest: string; integrity: string },
    stamps: boolean,
  ): Promise<{
    ok: boolean;
    violations: string[];
    merged: Record<string, unknown>;
    stamped: string[];
    bootOk: boolean;
  }> {
    const resolvedRelease = await resolveReleaseManifestForDeploy({
      configDir: childDir,
      authoredConfig,
      resolveOptions: { fetchManifest, fetchParent, fetchSlot },
    });
    const payload = structuredClone(authoredConfig);
    const app = payload.app as Record<string, Record<string, unknown>>;
    app.ui.production = `${base}/child-ui/`;
    app.ui.pin = ownUiPin;
    let stamped: string[] = [];
    if (stamps && resolvedRelease?.slots) {
      stamped = stampRemotesFromRelease({
        payload,
        authoredConfig,
        manifest: resolvedRelease,
      }).stamped;
    }
    const bootShape = await resolveBootShape(payload, CHILD_SLOT, { io: registryIo });
    const bootCheck = verifyResolvedBootShape(payload, bootShape);
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
      stamped,
      bootOk: bootCheck.ok,
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
      release: "2.0.0-rc.1",
      app: { ui: { development: "local:ui" } },
      plugins: { feedback: { extends: `bos://${ACCOUNT}/${GATEWAY}/votes` } },
    };
    const { ok, violations, merged, stamped, bootOk } = await simulateDeploy(
      authoredConfig,
      {
        manifest: "versions/fedcba0987654321.json",
        integrity: computeManifestSri(versionManifestText(childUiShared)),
      },
      true,
    );
    expect(bootOk).toBe(true);
    expect(violations).toEqual([]);

    // the release records the parent's plugin slots too — the child's own
    // declared plugin set owns that domain, so none of them stamp
    expect(stamped).toEqual(["app.auth", "app.auth.ui"]);
    const app = merged.app as Record<string, Record<string, Record<string, string>>>;
    expect(app.auth.pin.manifest).toBe("versions/auth-2.0.0-rc.1.json");
    expect(app.auth.ui.pin.manifest).toBe("versions/auth-ui-2.0.0-rc.1.json");
    expect(merged.plugins).toEqual({
      feedback: { extends: `bos://${ACCOUNT}/${GATEWAY}/votes` },
    });
    expect(ok).toBe(true);
  });

  it("without the stamps (a pre-slots release) the deploy gate blocks with the #546 skew and the remediation", async () => {
    const authoredConfig = {
      extends: `bos://${ACCOUNT}/${GATEWAY}`,
      account: "child.near",
      domain: "child.example",
      release: "2.0.0-rc.1",
      app: { ui: { development: "local:ui" } },
      plugins: { feedback: { extends: `bos://${ACCOUNT}/${GATEWAY}/votes` } },
    };
    const { ok, violations, bootOk } = await simulateDeploy(
      authoredConfig,
      {
        manifest: "versions/fedcba0987654321.json",
        integrity: computeManifestSri(versionManifestText(childUiShared)),
      },
      false,
    );
    expect(bootOk).toBe(true);
    expect(ok).toBe(false);
    const combined = violations.join("\n");
    expect(combined).toContain("Shared singleton");
    expect(combined).toContain("19.2.4");
    expect(combined).toContain("19.3.0");
    expect(combined).toContain("bos upgrade");
  });
});

/**
 * The mixed-tree replay (the Nov-02 upgrade incident): the release manifest
 * shipped caret catalog rows, so the child's `pnpm install --force`
 * re-resolved the caret to the newest published rc while template bytes
 * synced from the release tag — rc.N template bytes against rc.N+1 packages,
 * and every build failed on the removed db-surface exports. The regression
 * contract, end to end on the real compose + real upgrade paths:
 *
 *   1. a caret-authored root cannot publish a floating manifest — the
 *      compose freezes every resolvable row to the version the release was
 *      built with;
 *   2. the child upgrade consumes those exact rows verbatim — the catalog
 *      it leaves behind cannot float, whatever the registry's newest is;
 *   3. an install that already drifted past the release target fails the
 *      upgrade loud BEFORE anything mutates.
 */
describe("upgrade coherence — the mixed-tree replay (caret rows cannot float)", () => {
  const ACCOUNT = "misalign.near";
  const GATEWAY = "mixed-tree";
  const RELEASE_VERSION = "2.0.0-rc.30";
  const NEWER_RC_IN_THE_WILD = "2.0.0-rc.31";

  let rootDir: string;
  let childDir: string;
  let releaseManifest: Manifest;

  /** The incident's root: caret framework rows in the authored catalog (what
   * a pre-exact release shipped), workspace packages whose own versions are
   * what the release was built with, and a lockfile resolving the range rows
   * past the caret floor — rc.31 exists in the wild and a caret would float. */
  function caretRootFixture(): string {
    const dir = mkdtempSync(join(tmpdir(), "platform-e2e-caret-root-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "packages", "everything-dev"), { recursive: true });
    mkdirSync(join(dir, "packages", "every-plugin"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "everything-dev", "package.json"),
      `${JSON.stringify({ name: "everything-dev", version: RELEASE_VERSION })}\n`,
    );
    writeFileSync(
      join(dir, "packages", "every-plugin", "package.json"),
      `${JSON.stringify({ name: "every-plugin", version: "3.0.0-rc.15" })}\n`,
    );
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - packages/*",
        "",
        "catalog:",
        '  "everything-dev": "^2.0.0-rc.30"',
        '  "every-plugin": "^3.0.0-rc.15"',
        '  react: "^19.2.0"',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "",
        "  ui:",
        "    dependencies:",
        "      react:",
        "        specifier: 'catalog:'",
        "        version: 19.2.9(react-dom@19.2.9)",
        "",
      ].join("\n"),
    );
    writeFileSync(join(dir, "package.json"), "{}\n");
    return dir;
  }

  /** The pre-upgrade child: caret rows from the PREVIOUS release, no node_modules,
   * no platform pin — exactly the tree an `bos upgrade` arrives at. */
  function caretChildFixture(): string {
    const dir = mkdtempSync(join(tmpdir(), "platform-e2e-caret-child-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "ui"), { recursive: true });
    writeFileSync(
      join(dir, "bos.config.json"),
      `${JSON.stringify({
        extends: `bos://${ACCOUNT}/${GATEWAY}`,
        account: "child.near",
        domain: "child.example",
        app: { ui: { development: "local:ui" } },
      })}\n`,
    );
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - ui",
        "",
        "catalog:",
        '  "everything-dev": "^2.0.0-rc.29"',
        '  "every-plugin": "^3.0.0-rc.14"',
        '  react: "^19.2.0"',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({
        name: "monorepo",
        private: true,
        type: "module",
        dependencies: { "everything-dev": "catalog:", "every-plugin": "catalog:" },
      })}\n`,
    );
    writeFileSync(join(dir, "ui", "package.json"), `${JSON.stringify({ name: "ui" })}\n`);
    return dir;
  }

  function installNodeModules(dir: string, version: string): void {
    mkdirSync(join(dir, "node_modules", "everything-dev"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", "everything-dev", "package.json"),
      `${JSON.stringify({ name: "everything-dev", version })}\n`,
    );
  }

  /** The upgrade seams that reach outside the fixture tree — the manifest leg
   * resolves the composed bytes from this describe's fixture (never a
   * hand-written manifest), everything else is the harness boundary. The
   * machine mock answers both queries the upgrade source makes (Latest
   * target + record verification). */
  function mockUpgradeSeams(): void {
    vi.spyOn(resolutionModule, "resolveRelease").mockImplementation(async (input) => {
      if (input.query.kind === "Pinned" && input.query.release === RELEASE_VERSION) {
        return {
          state: "Resolved",
          manifest: releaseManifest,
          source: { account: ACCOUNT, gateway: GATEWAY },
          from: "version",
          provenance: "slot",
          fromCache: false,
        } as never;
      }
      return {
        state: "Resolved",
        manifest: releaseManifest,
        source: { account: ACCOUNT, gateway: GATEWAY },
        from: "manifest",
        provenance: "pointer",
        fromCache: false,
      } as never;
    });
    vi.spyOn(initSourceModule, "fetchParentConfig").mockResolvedValue({
      repository: "https://github.com/NEARBuilders/everything-dev",
    } as never);
    vi.spyOn(sessionModule, "openResolution").mockResolvedValue({
      config: { account: "child.near", domain: "child.example" },
    } as never);
    vi.spyOn(sharedDepsModule, "syncResolvedSharedDeps").mockResolvedValue({
      mode: "bos->catalog",
      hostMode: "local",
      bosConfigChanged: false,
      catalogChanged: false,
      generatedChanged: false,
      resolved: { deps: {}, fingerprintSha256: "" },
    } as never);
    vi.spyOn(initModule, "runPnpmInstallForUpgrade").mockResolvedValue();
    vi.spyOn(initModule, "runTypesGen").mockResolvedValue();
    vi.spyOn(syncModule, "syncTemplate").mockResolvedValue({
      status: "synced",
      updated: [],
      skipped: [],
      added: [],
      conflicted: [],
    } as never);
  }

  beforeAll(() => {
    rootDir = caretRootFixture();
    const entry = composePlatformManifestPublishEntry({
      configDir: rootDir,
      account: ACCOUNT,
      gateway: GATEWAY,
    });
    expect(entry).not.toBeNull();
    releaseManifest = entry!.manifest;
    // the real train's atomic write: the immutable version slot + the pointer
    registry.set(entry!.key, JSON.parse(entry!.value));
    registry.set(getVersionKey(ACCOUNT, GATEWAY, RELEASE_VERSION), JSON.parse(entry!.value));
    registry.set(`apps/${ACCOUNT}/${GATEWAY}/bos.config.json`, {
      repository: "https://github.com/NEARBuilders/everything-dev",
    });
  });

  beforeEach(() => {
    childDir = caretChildFixture();
  });

  afterAll(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a caret-authored root publishes exact rows — the manifest cannot float", () => {
    expect(releaseManifest.catalog["everything-dev"]).toBe(RELEASE_VERSION);
    expect(releaseManifest.catalog["every-plugin"]).toBe("3.0.0-rc.15");
    expect(releaseManifest.catalog.react).toBe("19.2.9");
    // the anti-float wire invariant: no framework row is a caret that
    // `pnpm install --force` could re-resolve past this release
    for (const name of ["everything-dev", "every-plugin"] as const) {
      expect(releaseManifest.catalog[name]).not.toMatch(/^[\^~]/);
    }
  });

  it("the child upgrade consumes the exact rows verbatim — the catalog it leaves behind cannot float", async () => {
    mockUpgradeSeams();

    const result = await upgradeTemplate(childDir, {
      dryRun: false,
      noInstall: true,
      noSync: false,
    });

    expect(result.status).toBe("upgraded");
    const childCatalog = readWorkspaceCatalog(childDir);
    // the caret rows (^2.0.0-rc.29 / ^3.0.0-rc.14 / ^19.2.0) landed exact
    expect(childCatalog["everything-dev"]).toBe(RELEASE_VERSION);
    expect(childCatalog["every-plugin"]).toBe("3.0.0-rc.15");
    expect(childCatalog.react).toBe("19.2.9");
    // the pin froze to the release the upgrade landed from
    expect(result.migrated).toContain("bos.config.json");
    const migratedConfig = JSON.parse(readFileSync(join(childDir, "bos.config.json"), "utf-8")) as {
      release?: string;
    };
    expect(migratedConfig.release).toBe(RELEASE_VERSION);
    // the coherence floor: the exact catalog plus the release install is
    // coherent, and the newer rc that floated past it is named by the gate
    expect(
      installDriftError(
        { "everything-dev": RELEASE_VERSION, "every-plugin": "3.0.0-rc.15" },
        childCatalog,
      ),
    ).toBeUndefined();
    expect(
      installDriftError(
        { "everything-dev": NEWER_RC_IN_THE_WILD, "every-plugin": "3.0.0-rc.15" },
        childCatalog,
      ),
    ).toContain(`everything-dev installed ${NEWER_RC_IN_THE_WILD}`);
  });

  it("an install that already floated past the release fails the upgrade loud — the migration phase never runs", async () => {
    installNodeModules(childDir, NEWER_RC_IN_THE_WILD);
    mockUpgradeSeams();

    await expect(
      upgradeTemplate(childDir, { dryRun: false, noInstall: true, noSync: false }),
    ).rejects.toThrow(
      new RegExp(
        `everything-dev installed ${NEWER_RC_IN_THE_WILD} vs release target ${RELEASE_VERSION}`,
      ),
    );

    // The gate is the migration phase's tripwire: Phase 1 may have synced the
    // catalog rows (the repair install is exactly what a real --no-install run
    // skips) and the read-only preflight dry-run may probe, but no applying
    // sync ever ran — no template bytes stamped over the drifted packages, no
    // pin frozen to the release.
    const applyingSyncs = vi
      .mocked(syncModule.syncTemplate)
      .mock.calls.filter(([, opts]) => !opts?.dryRun);
    expect(applyingSyncs).toEqual([]);
    const migratedConfig = JSON.parse(readFileSync(join(childDir, "bos.config.json"), "utf-8")) as {
      release?: string;
    };
    expect(migratedConfig.release).toBeUndefined();
  });
});
