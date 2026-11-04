import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compatWindowViolations,
  composePlatformManifestPublishEntry,
  deriveImageRefFromPlatformManifest,
  PLATFORM_IMAGE_REF,
  platformTruthViolations,
  resolveExactCatalog,
} from "../../src/services/deploy/platform-manifest";
import { ManifestSchema } from "../../src/services/platform/manifest";

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
    const parsed = ManifestSchema.parse(JSON.parse(entry!.value));
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

describe("resolveExactCatalog", () => {
  function scaffoldExactCatalogRoot(): string {
    const dir = scaffoldFrameworkRoot();
    mkdirSync(join(tmpRoot, "packages", "better-near-auth"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "packages", "better-near-auth", "package.json"),
      `${JSON.stringify({ name: "better-near-auth", version: "2.0.0-rc.6" })}\n`,
    );
    writeFileSync(
      join(tmpRoot, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - packages/*",
        "",
        "catalog:",
        '  "everything-dev": "^2.0.0-rc.14"',
        '  "every-plugin": "^3.0.0-rc.9"',
        '  "better-near-auth": "^2.0.0-rc.6"',
        '  react: "^19.2.0"',
        '  effect: "4.0.0-rc.112"',
        '  "@hot-labs/near-connect": "elliotBraem/near-connect#v0.12.0-fork.3"',
        '  "not-in-lockfile": "^1.2.3"',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(tmpRoot, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "",
        "  api:",
        "    dependencies:",
        "      react:",
        "        specifier: 'catalog:'",
        "        version: 19.2.9(react-dom@19.2.9)",
        "",
      ].join("\n"),
    );
    return dir;
  }

  it("freezes workspace rows, lockfile-resolves ranges, keeps unknowable rows", () => {
    const catalog = resolveExactCatalog(scaffoldExactCatalogRoot());
    expect(catalog["everything-dev"]).toBe("2.0.0-rc.14");
    expect(catalog["every-plugin"]).toBe("3.0.0-rc.9");
    expect(catalog["better-near-auth"]).toBe("2.0.0-rc.6");
    expect(catalog.react).toBe("19.2.9");
    expect(catalog.effect).toBe("4.0.0-rc.112");
    expect(catalog["@hot-labs/near-connect"]).toBe("elliotBraem/near-connect#v0.12.0-fork.3");
    expect(catalog["not-in-lockfile"]).toBe("^1.2.3");
  });

  it("the composed release manifest carries the exact rows — children can no longer float", () => {
    const entry = composePlatformManifestPublishEntry({
      configDir: scaffoldExactCatalogRoot(),
      account: "root.near",
      gateway: "root",
    });
    const parsed = ManifestSchema.parse(JSON.parse(entry!.value));
    expect(parsed.catalog["everything-dev"]).toBe("2.0.0-rc.14");
    expect(parsed.catalog.react).toBe("19.2.9");
    expect(parsed.catalog["not-in-lockfile"]).toBe("^1.2.3");
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
    const manifest = ManifestSchema.parse({
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
    const manifest = ManifestSchema.parse({
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
    const manifest = ManifestSchema.parse({
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
    const manifest = ManifestSchema.parse({
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

describe("compatWindowViolations", () => {
  const pin = (version: string) => ({
    version,
    requiredVersion: "19.2.9",
    singleton: true,
    strictVersion: true,
    eager: false,
    shareScope: "default",
  });

  it("flags a build chain that moved mid-version under an unchanged pointer — the Nov-02 skew", () => {
    const violations = compatWindowViolations(
      { react: pin("19.2.9") },
      new Map([
        ["ui", { react: "19.2.9" }],
        ["agent-connect", { react: "19.2.4" }],
      ]),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("agent-connect was built against react@19.2.4");
    expect(violations[0]).toContain("serves 19.2.9");
    expect(violations[0]).toContain("compat window moved mid-version");
  });

  it("clean when every embedded chain row satisfies the pinned window", () => {
    const violations = compatWindowViolations(
      { react: pin("19.2.9") },
      new Map([
        ["ui", { react: "19.2.9" }],
        ["auth", { react: "19.2.9" }],
      ]),
    );
    expect(violations).toEqual([]);
  });

  it("skips names the published window does not pin", () => {
    const violations = compatWindowViolations(
      { react: pin("19.2.9") },
      new Map([["ui", { react: "19.2.9", "brand-new-dep": "1.0.0" }]]),
    );
    expect(violations).toEqual([]);
  });
});
