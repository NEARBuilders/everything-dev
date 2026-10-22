import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkPlatformCompat,
  composePlatformReleaseManifest,
  computeTemplateInventory,
  getPlatformManifestKey,
  PlatformReleaseManifestSchema,
  serializePlatformReleaseManifest,
} from "../../src/services/platform/manifest";

const tmpRoot = join(import.meta.dirname, ".platform-manifest-fixture");

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const baseInputs = {
  frameworkVersion: "2.0.0-rc.14",
  everyPluginVersion: "3.0.0-rc.9",
  imageRef: "ghcr.io/nearbuilders/everything-dev",
  catalog: { react: "19.2.4", effect: "4.0.0-rc.112", zod: "4.6.5" } as Record<string, string>,
  templateInventory: [{ path: "package.json", sha256: "a".repeat(64) }],
  compatMinChild: "1.53.0",
};

describe("composePlatformReleaseManifest", () => {
  it("composes the release contract: schema, kind, versions, image tags, compat floor", () => {
    const manifest = composePlatformReleaseManifest(baseInputs);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.kind).toBe("everything-dev/platform-manifest");
    expect(manifest.frameworkVersion).toBe("2.0.0-rc.14");
    expect(manifest.everyPluginVersion).toBe("3.0.0-rc.9");
    // only the derivable version tag — sha-tags are git facts an image build
    // cannot see; derivation keys off ref@v<version> (ADR 0034 pt 2)
    expect(manifest.image.ref).toBe("ghcr.io/nearbuilders/everything-dev");
    expect(manifest.image.tags).toEqual(["v2.0.0-rc.14"]);
    expect(manifest.compat).toEqual({ minChild: "1.53.0" });
  });

  it("carries the serving build's git sha when the compose context has one (#537) and drops the field when it does not", () => {
    const withSha = composePlatformReleaseManifest({ ...baseInputs, gitSha: "a".repeat(40) });
    expect(withSha.gitSha).toBe("a".repeat(40));
    expect(
      PlatformReleaseManifestSchema.parse(JSON.parse(serializePlatformReleaseManifest(withSha))),
    ).toEqual(withSha);
    const withoutSha = composePlatformReleaseManifest(baseInputs);
    expect("gitSha" in withoutSha).toBe(false);
  });

  it("serializes deterministically — same inputs, byte-identical manifest", () => {
    const a = serializePlatformReleaseManifest(composePlatformReleaseManifest(baseInputs));
    const b = serializePlatformReleaseManifest(composePlatformReleaseManifest({ ...baseInputs }));
    expect(a).toBe(b);
  });

  it("composes sharedDeps from the release catalog — critical deps pin exact versions, non-critical stay ranged", () => {
    const manifest = composePlatformReleaseManifest(baseInputs);
    // effect is effect-critical → exact-version pin with strictVersion (shared-deps-spec)
    expect(manifest.sharedDeps.effect).toMatchObject({
      version: "4.0.0-rc.112",
      requiredVersion: "4.0.0-rc.112",
      singleton: true,
      strictVersion: true,
    });
    // zod is a non-critical singleton → requiredVersion false
    expect(manifest.sharedDeps.zod).toMatchObject({
      version: "4.6.5",
      requiredVersion: false,
      strictVersion: false,
    });
    // react comes from the ui spec list
    expect(manifest.sharedDeps.react).toMatchObject({
      version: "19.2.4",
      requiredVersion: "19.2.4",
      strictVersion: true,
    });
  });

  it("parses back through the published schema", () => {
    const manifest = composePlatformReleaseManifest(baseInputs);
    expect(
      PlatformReleaseManifestSchema.parse(JSON.parse(serializePlatformReleaseManifest(manifest))),
    ).toEqual(manifest);
  });
});

describe("getPlatformManifestKey", () => {
  it("names the well-known slot beside the published config", () => {
    expect(getPlatformManifestKey("dev.everything.near", "everything.dev")).toBe(
      "apps/dev.everything.near/everything.dev/platform.json",
    );
  });
});

describe("computeTemplateInventory", () => {
  it("hashes the ownership inventory from the release source, skips missing files, sorts by path", () => {
    mkdirSync(join(tmpRoot, "api", "src"), { recursive: true });
    mkdirSync(join(tmpRoot, ".agents", "skills", "x"), { recursive: true });
    writeFileSync(join(tmpRoot, "package.json"), "{}\n");
    writeFileSync(join(tmpRoot, "api", "src", "global.d.ts"), "// types\n");
    writeFileSync(join(tmpRoot, ".agents", "skills", "x", "SKILL.md"), "skill\n");

    const inventory = computeTemplateInventory(tmpRoot);
    const paths = inventory.map((entry) => entry.path);
    expect(paths).toContain("package.json");
    expect(paths).toContain("api/src/global.d.ts");
    expect(paths).toContain(".agents/skills/x/SKILL.md");
    // the db seam is app-owned (ADR 0033) — never inventoried
    expect(paths).not.toContain("api/src/db/layer.ts");
    expect(paths).toEqual([...paths].sort());
    for (const entry of inventory) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("checkPlatformCompat", () => {
  const manifest = composePlatformReleaseManifest(baseInputs);

  it("accepts a child inside the compat window with matching singleton versions", () => {
    const violations = checkPlatformCompat(manifest, {
      platformVersion: "2.0.0-rc.14",
      catalog: baseInputs.catalog,
    });
    expect(violations).toEqual([]);
  });

  it("rejects a child older than the compat floor", () => {
    const violations = checkPlatformCompat(manifest, {
      platformVersion: "1.52.0",
      catalog: baseInputs.catalog,
    });
    expect(violations.some((v) => v.kind === "minChild")).toBe(true);
  });

  it("rejects a child newer than the release", () => {
    const violations = checkPlatformCompat(manifest, {
      platformVersion: "2.1.0",
      catalog: baseInputs.catalog,
    });
    expect(violations.some((v) => v.kind === "minChild")).toBe(true);
  });

  it("rejects a skewed strict shared dep (singleton versions must agree exactly)", () => {
    const violations = checkPlatformCompat(manifest, {
      platformVersion: "2.0.0-rc.14",
      catalog: { ...baseInputs.catalog, effect: "4.0.0-rc.100" },
    });
    expect(violations.some((v) => v.kind === "shared-dep" && v.name === "effect")).toBe(true);
  });

  it("rejects a missing strict shared dep", () => {
    const violations = checkPlatformCompat(manifest, {
      platformVersion: "2.0.0-rc.14",
      catalog: { zod: "4.6.5" },
    });
    expect(violations.some((v) => v.kind === "shared-dep" && v.name === "effect")).toBe(true);
  });
});
