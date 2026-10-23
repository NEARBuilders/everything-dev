import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  composePlatformManifestPublishEntry,
  deriveImageRefFromPlatformManifest,
  PLATFORM_IMAGE_REF,
  platformTruthViolations,
} from "../../src/services/deploy/platform-manifest";
import { PlatformReleaseManifestSchema } from "../../src/services/platform/manifest";

const tmpRoot = join(import.meta.dirname, ".platform-publish-fixture");

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function scaffoldFrameworkRoot(): string {
  mkdirSync(join(tmpRoot, "packages", "everything-dev"), { recursive: true });
  mkdirSync(join(tmpRoot, "packages", "every-plugin"), { recursive: true });
  mkdirSync(join(tmpRoot, ".agents", "skills", "demo"), { recursive: true });
  writeFileSync(
    join(tmpRoot, "packages", "everything-dev", "package.json"),
    `${JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.14" })}\n`,
  );
  writeFileSync(
    join(tmpRoot, "packages", "every-plugin", "package.json"),
    `${JSON.stringify({ name: "every-plugin", version: "3.0.0-rc.9" })}\n`,
  );
  writeFileSync(
    join(tmpRoot, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - packages/*",
      "",
      "catalog:",
      '  react: "19.2.4"',
      '  effect: "4.0.0-rc.112"',
      "",
    ].join("\n"),
  );
  writeFileSync(join(tmpRoot, "package.json"), "{}\n");
  return tmpRoot;
}

describe("composePlatformManifestPublishEntry", () => {
  it("composes the registry entry for a framework-rooted deploy — slot key, SRI, schema-valid bytes", () => {
    const configDir = scaffoldFrameworkRoot();
    const entry = composePlatformManifestPublishEntry({
      configDir,
      account: "dev.everything.near",
      gateway: "everything.dev",
      previousFrameworkVersion: "2.0.0-rc.13",
    });
    expect(entry).not.toBeNull();
    expect(entry!.key).toBe("apps/dev.everything.near/everything.dev/platform.json");
    expect(entry!.integrity).toMatch(/^sha384-/);
    const parsed = PlatformReleaseManifestSchema.parse(JSON.parse(entry!.value));
    expect(parsed.frameworkVersion).toBe("2.0.0-rc.14");
    expect(parsed.everyPluginVersion).toBe("3.0.0-rc.9");
    expect(parsed.image.ref).toBe(PLATFORM_IMAGE_REF);
    expect(parsed.image.tags).toEqual(["v2.0.0-rc.14"]);
    // the compat floor is the previous release — children on it stay accepted
    expect(parsed.compat.minChild).toBe("2.0.0-rc.13");
    expect(parsed.sharedDeps.effect?.version).toBe("4.0.0-rc.112");
    expect(parsed.templateInventory.map((t) => t.path)).toContain("package.json");
  });

  it("is byte-stable across compositions of the same inputs", () => {
    const configDir = scaffoldFrameworkRoot();
    const a = composePlatformManifestPublishEntry({
      configDir,
      account: "a.near",
      gateway: "g",
    });
    const b = composePlatformManifestPublishEntry({
      configDir,
      account: "a.near",
      gateway: "g",
    });
    expect(a!.value).toBe(b!.value);
  });

  it("returns null for a non-framework-rooted deploy — children never publish a release manifest", () => {
    mkdirSync(tmpRoot, { recursive: true });
    const entry = composePlatformManifestPublishEntry({
      configDir: tmpRoot,
      account: "citynode.near",
      gateway: "citynode",
    });
    expect(entry).toBeNull();
  });
});

describe("deriveImageRefFromPlatformManifest", () => {
  it("derives ref@version-tag from the resolved manifest — no hand-pinned image", async () => {
    const configDir = scaffoldFrameworkRoot();
    const manifest = composePlatformManifestPublishEntry({
      configDir,
      account: "root.near",
      gateway: "root",
    })!.manifest;
    const derived = await deriveImageRefFromPlatformManifest({
      configDir,
      localConfig: { extends: "bos://root.near/root" },
      fetchManifest: async () => manifest,
    });
    expect(derived).toEqual({
      image: "ghcr.io/nearbuilders/everything-dev",
      tag: "v2.0.0-rc.14",
      digest: undefined,
    });
  });

  it("returns null when no manifest resolves — today's resolution rules apply", async () => {
    const derived = await deriveImageRefFromPlatformManifest({
      configDir: tmpRoot,
      localConfig: {},
      fetchManifest: async () => null,
    });
    expect(derived).toBeNull();
  });
});

describe("platformTruthViolations", () => {
  it("flags a workspace whose installed shared version disagrees with the release manifest (#546)", () => {
    const manifest = PlatformReleaseManifestSchema.parse({
      schemaVersion: 1,
      kind: "everything-dev/platform-manifest",
      frameworkVersion: "2.0.0-rc.18",
      everyPluginVersion: "3.0.0-rc.10",
      image: { ref: PLATFORM_IMAGE_REF, tags: ["v2.0.0-rc.18"] },
      catalog: {},
      sharedDeps: {
        react: {
          version: "19.2.9",
          requiredVersion: "19.2.9",
          singleton: true,
          strictVersion: true,
          eager: false,
          shareScope: "default",
        },
      },
      templateInventory: [],
      compat: { minChild: "2.0.0-rc.17" },
    });

    const violations = platformTruthViolations(
      manifest,
      new Map([
        ["ui", { react: "19.2.9" }],
        ["votes", { react: "19.2.4" }],
      ]),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("votes was built against react@19.2.4");
    expect(violations[0]).toContain("pins 19.2.9");
  });

  it("passes when every workspace's shared record agrees with the release manifest", () => {
    const manifest = PlatformReleaseManifestSchema.parse({
      schemaVersion: 1,
      kind: "everything-dev/platform-manifest",
      frameworkVersion: "2.0.0-rc.18",
      everyPluginVersion: "3.0.0-rc.10",
      image: { ref: PLATFORM_IMAGE_REF, tags: ["v2.0.0-rc.18"] },
      catalog: {},
      sharedDeps: {
        react: {
          version: "19.2.9",
          requiredVersion: "19.2.9",
          singleton: true,
          strictVersion: true,
          eager: false,
          shareScope: "default",
        },
      },
      templateInventory: [],
      compat: { minChild: "2.0.0-rc.17" },
    });

    const violations = platformTruthViolations(
      manifest,
      new Map([
        ["ui", { react: "19.2.9", reactDom: "19.2.9" }],
        ["votes-ui", { react: "19.2.9" }],
      ]),
    );

    expect(violations).toEqual([]);
  });

  it("passes when a range-shaped pin is satisfied by the exact built version", () => {
    const manifest = PlatformReleaseManifestSchema.parse({
      schemaVersion: 1,
      kind: "everything-dev/platform-manifest",
      frameworkVersion: "2.0.0-rc.18",
      everyPluginVersion: "3.0.0-rc.11",
      image: { ref: PLATFORM_IMAGE_REF, tags: ["v2.0.0-rc.18"] },
      catalog: { "every-plugin": "^3.0.0-rc.11" },
      sharedDeps: {
        "every-plugin": {
          version: "^3.0.0-rc.11",
          requiredVersion: "^3.0.0-rc.11",
          singleton: true,
          strictVersion: true,
          eager: false,
          shareScope: "default",
        },
      },
      templateInventory: [],
      compat: { minChild: "2.0.0-rc.17" },
    });

    const violations = platformTruthViolations(
      manifest,
      new Map([
        ["api", { "every-plugin": "3.0.0-rc.11" }],
        ["votes", { "every-plugin": "3.0.0-rc.11" }],
      ]),
    );

    expect(violations).toEqual([]);
  });

  it("flags a built prerelease that falls below the range-shaped pin's floor", () => {
    const manifest = PlatformReleaseManifestSchema.parse({
      schemaVersion: 1,
      kind: "everything-dev/platform-manifest",
      frameworkVersion: "2.0.0-rc.18",
      everyPluginVersion: "3.0.0-rc.11",
      image: { ref: PLATFORM_IMAGE_REF, tags: ["v2.0.0-rc.18"] },
      catalog: { "every-plugin": "^3.0.0-rc.11" },
      sharedDeps: {
        "every-plugin": {
          version: "^3.0.0-rc.11",
          requiredVersion: "^3.0.0-rc.11",
          singleton: true,
          strictVersion: true,
          eager: false,
          shareScope: "default",
        },
      },
      templateInventory: [],
      compat: { minChild: "2.0.0-rc.17" },
    });

    const violations = platformTruthViolations(
      manifest,
      new Map([["api", { "every-plugin": "3.0.0-rc.9" }]]),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("api was built against every-plugin@3.0.0-rc.9");
    expect(violations[0]).toContain("pins ^3.0.0-rc.11");
  });
});
