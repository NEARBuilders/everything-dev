import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  buildChildAgentsMd,
  buildInitPatterns,
  buildPluginRouteExclusions,
  copyFilteredFiles,
  personalizeConfig,
} from "../../src/cli/init";
import { loadManifestNormalizationSpec } from "../../src/internal/manifest-normalizer";
import { writeChildConfigFixture } from "../helpers/parent-config";

const REPO_ROOT = join(import.meta.dirname, "../../../../");

function readChildWorkspacePackages(dir: string): string[] | undefined {
  const yamlPath = join(dir, "pnpm-workspace.yaml");
  if (!existsSync(yamlPath)) return undefined;
  const doc = parseYaml(readFileSync(yamlPath, "utf-8")) as { packages?: string[] };
  return doc.packages;
}

function readChildWorkspaceCatalog(dir: string): Record<string, string> | undefined {
  const yamlPath = join(dir, "pnpm-workspace.yaml");
  if (!existsSync(yamlPath)) return undefined;
  const doc = parseYaml(readFileSync(yamlPath, "utf-8")) as { catalog?: Record<string, string> };
  return doc.catalog;
}
const MANIFEST_SPEC = loadManifestNormalizationSpec(REPO_ROOT);

const DEFAULT_OVERRIDES = ["ui", "api"] as const;
// The base repo no longer commits bos.config.json (authored config lives in
// bos.app.ts; the resolved file is generated). Tests seed a child config
// fixture shaped like the scaffold output — see tests/helpers/parent-config.

describe("bos init — structure", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-init-structure-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("builds curated root and selected surface patterns", () => {
    const patterns = buildInitPatterns(["ui", "api", "plugins"], ["registry"]);
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns).toContain("bos.config.json");
    expect(patterns).toContain("ui/**");
    expect(patterns).toContain(".github/templates/api/**");
    expect(patterns).toContain("plugins/registry/**");
  });

  it("copies curated root files and selected surfaces", async () => {
    const patterns = buildInitPatterns(["ui", "api", "plugins"], ["registry"]);
    const filesCopied = await copyFilteredFiles(REPO_ROOT, testDir, patterns, {
      overrides: ["ui", "api", "plugins"],
      plugins: ["registry"],
    });

    expect(filesCopied).toBeGreaterThan(0);

    // The resolved config is generated, not copied — the scaffold writes the
    // child's config from the fetched parent config.
    expect(existsSync(join(testDir, "bos.config.json"))).toBe(false);
    expect(existsSync(join(testDir, "biome.json"))).toBe(true);
    expect(existsSync(join(testDir, ".github", "workflows", "ci.yml"))).toBe(true);
    expect(existsSync(join(testDir, ".github", "workflows", "deploy.yml"))).toBe(true);
    expect(existsSync(join(testDir, ".github", "renovate.json"))).toBe(false);
    expect(existsSync(join(testDir, ".github", "workflows", "packages-release.yml"))).toBe(false);
    expect(existsSync(join(testDir, ".github", "workflows", "release.yml"))).toBe(true);
    expect(existsSync(join(testDir, ".github", "workflows", "staging.yml"))).toBe(true);
    expect(existsSync(join(testDir, "CONTRIBUTING.md"))).toBe(true);
    expect(existsSync(join(testDir, "api/src/contract.ts"))).toBe(true);
    expect(existsSync(join(testDir, "ui/src/lib/api.ts"))).toBe(true);
    expect(existsSync(join(testDir, "ui/src/styles.css"))).toBe(true);

    expect(existsSync(join(testDir, "plugins/registry"))).toBe(true);
    expect(existsSync(join(testDir, "plugins/example"))).toBe(false);

    expect(existsSync(join(testDir, "host"))).toBe(false);
    expect(existsSync(join(testDir, "packages"))).toBe(false);
    expect(existsSync(join(testDir, "plans"))).toBe(false);
    expect(existsSync(join(testDir, ".agent"))).toBe(false);
    expect(existsSync(join(testDir, ".opencode"))).toBe(false);
    expect(existsSync(join(testDir, ".changeset"))).toBe(true);
  });

  it("copies selected plugin directories when plugins override is active", async () => {
    const selectedDir = mkdtempSync(join(tmpdir(), "bos-init-selected-plugins-"));
    try {
      const patterns = buildInitPatterns(["ui", "api", "plugins"], ["registry"]);
      await copyFilteredFiles(REPO_ROOT, selectedDir, patterns, {
        overrides: ["ui", "api", "plugins"],
        plugins: ["registry"],
      });

      expect(existsSync(join(selectedDir, "plugins", "registry"))).toBe(true);
      expect(existsSync(join(selectedDir, "plugins", "example"))).toBe(false);
    } finally {
      rmSync(selectedDir, { recursive: true, force: true });
    }
  });

  it("completes init cleanly when no plugins are selected within plugins override", async () => {
    const noPluginsDir = mkdtempSync(join(tmpdir(), "bos-init-no-plugins-"));
    try {
      const patterns = buildInitPatterns(["ui", "api", "plugins"], []);
      const parentConfig = { plugins: {} } as Record<string, unknown>;
      writeChildConfigFixture(noPluginsDir, ["ui", "api"], {});
      const routeExclusions = buildPluginRouteExclusions(parentConfig, []);
      await copyFilteredFiles(REPO_ROOT, noPluginsDir, patterns, {
        overrides: ["ui", "api", "plugins"],
        plugins: [],
        ignore: routeExclusions,
      });
      await personalizeConfig(noPluginsDir, {
        extendsAccount: "dev.everything.near",
        extendsGateway: "everything.dev",
        account: "test.near",
        domain: "test.dev",
        plugins: [],
        overrides: ["ui", "api", "plugins"],
        workspaceOpts: { sourceDir: REPO_ROOT },
      });

      expect(existsSync(join(noPluginsDir, "plugins"))).toBe(false);

      expect(existsSync(join(noPluginsDir, "ui/src/routes/_public/apps"))).toBe(false);
      expect(existsSync(join(noPluginsDir, "ui/src/routes/_public/index.tsx"))).toBe(true);

      const config = JSON.parse(readFileSync(join(noPluginsDir, "bos.config.json"), "utf-8"));
      expect(config.plugins).toEqual({});

      expect(readChildWorkspacePackages(noPluginsDir)).toContain("plugins/*");
    } finally {
      rmSync(noPluginsDir, { recursive: true, force: true });
    }
  });

  it("personalizes bos.config.json removing non-overridden app sections", async () => {
    writeChildConfigFixture(testDir, ["host", "ui", "api"]);
    await personalizeConfig(testDir, {
      extendsAccount: "dev.everything.near",
      extendsGateway: "everything.dev",
      account: "test.near",
      domain: "test.dev",
      workspaceOpts: { sourceDir: REPO_ROOT },
      overrides: [...DEFAULT_OVERRIDES],
    });

    const config = JSON.parse(readFileSync(join(testDir, "bos.config.json"), "utf-8"));
    expect(config.account).toBe("test.near");
    expect(config.domain).toBe("test.dev");
    expect(config.extends).toBe("bos://dev.everything.near/everything.dev");
  });

  it("preserves catalog refs for framework packages", () => {
    const rootPkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf-8")) as {
      name?: string;
      private?: boolean;
      dependencies?: Record<string, string>;
      module?: string;
      peerDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const rootCatalog = readChildWorkspaceCatalog(testDir);
    const uiPkg = JSON.parse(readFileSync(join(testDir, "ui", "package.json"), "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    const apiPkg = JSON.parse(readFileSync(join(testDir, "api", "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(rootPkg.dependencies?.["everything-dev"]).toBe("catalog:");
    expect(rootPkg.dependencies?.["every-plugin"]).toBe("catalog:");
    expect(rootPkg.name).toBe("monorepo");
    expect(rootPkg.private).toBe(true);
    expect(rootPkg.module).toBeUndefined();
    expect(rootPkg.peerDependencies).toBeUndefined();
    expect(rootPkg.scripts?.version).toBe("changeset version");
    expect(rootPkg.scripts?.["sync-catalog"]).toBeUndefined();
    expect(rootCatalog?.["everything-dev"]).toBe(MANIFEST_SPEC.rootCatalog["everything-dev"]);
    expect(rootCatalog?.["every-plugin"]).toBe(MANIFEST_SPEC.rootCatalog["every-plugin"]);
    expect(uiPkg.devDependencies?.["every-plugin"]).toBe("catalog:");
    expect(uiPkg.devDependencies?.["everything-dev"]).toBe("catalog:");
    expect(apiPkg.dependencies?.["every-plugin"]).toBe("catalog:");
    expect(apiPkg.devDependencies?.["everything-dev"]).toBe("catalog:");
  });

  it("removes production URLs from overridden app sections", () => {
    const config = JSON.parse(readFileSync(join(testDir, "bos.config.json"), "utf-8"));
    expect(config.app.ui.production).toBeUndefined();
    expect(config.app.api.production).toBeUndefined();
    expect(config.app.ui.integrity).toBeUndefined();
    expect(config.app.api.integrity).toBeUndefined();
  });

  it("includes host when overrides includes host", async () => {
    const hostTestDir = mkdtempSync(join(tmpdir(), "bos-init-host-"));
    try {
      const hostPatterns = buildInitPatterns(["ui", "api", "host"]);
      await copyFilteredFiles(REPO_ROOT, hostTestDir, hostPatterns, {
        overrides: ["ui", "api", "host"],
      });
      writeChildConfigFixture(hostTestDir, ["host", "ui", "api"]);
      await personalizeConfig(hostTestDir, {
        extendsAccount: "dev.everything.near",
        extendsGateway: "everything.dev",
        account: "test.near",
        domain: "test.dev",
        workspaceOpts: { sourceDir: REPO_ROOT },
        overrides: ["ui", "api", "host"],
      });
      const hostPkg = JSON.parse(
        readFileSync(join(hostTestDir, "host", "package.json"), "utf-8"),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(existsSync(join(hostTestDir, "host/src/program.ts"))).toBe(true);
      expect(hostPkg.devDependencies?.["everything-dev"]).toBe("catalog:");
      expect(hostPkg.dependencies?.["every-plugin"]).toBe("catalog:");
    } finally {
      rmSync(hostTestDir, { recursive: true, force: true });
    }
  });

  it("supports scaffolding a single selected surface", async () => {
    const apiOnlyDir = mkdtempSync(join(tmpdir(), "bos-init-api-only-"));
    try {
      const patterns = buildInitPatterns(["api"]);
      await copyFilteredFiles(REPO_ROOT, apiOnlyDir, patterns, { overrides: ["api"] });
      writeChildConfigFixture(apiOnlyDir, ["host", "ui", "api"]);
      await personalizeConfig(apiOnlyDir, {
        extendsAccount: "dev.everything.near",
        extendsGateway: "everything.dev",
        account: "test.near",
        domain: "test.dev",
        overrides: ["api"],
        workspaceOpts: { sourceDir: REPO_ROOT },
      });

      expect(existsSync(join(apiOnlyDir, "api", "package.json"))).toBe(true);
      expect(existsSync(join(apiOnlyDir, "ui", "package.json"))).toBe(false);
      const config = JSON.parse(readFileSync(join(apiOnlyDir, "bos.config.json"), "utf-8"));
      const pkg = JSON.parse(readFileSync(join(apiOnlyDir, "package.json"), "utf-8")) as {
        scripts?: Record<string, string>;
      };
      expect(config.app.api).toBeDefined();
      expect(config.app.ui).toBeUndefined();
      expect(pkg.scripts?.["db:push"]).toBeDefined();
      expect(pkg.scripts?.["test:api"]).toBeDefined();
      expect(pkg.scripts?.["test:e2e"]).toBeUndefined();
      expect(pkg.scripts?.["dev:api"]).toBeDefined();
      expect(pkg.scripts?.["dev:ui"]).toBeUndefined();
    } finally {
      rmSync(apiOnlyDir, { recursive: true, force: true });
    }
  });

  it("omits api and host-only root scripts for a ui-only child", async () => {
    const uiOnlyDir = mkdtempSync(join(tmpdir(), "bos-init-ui-only-"));
    try {
      const patterns = buildInitPatterns(["ui"]);
      await copyFilteredFiles(REPO_ROOT, uiOnlyDir, patterns, { overrides: ["ui"] });
      writeChildConfigFixture(uiOnlyDir, ["host", "ui", "api"]);
      await personalizeConfig(uiOnlyDir, {
        extendsAccount: "dev.everything.near",
        extendsGateway: "everything.dev",
        account: "test.near",
        domain: "test.dev",
        overrides: ["ui"],
        workspaceOpts: { sourceDir: REPO_ROOT },
      });

      const pkg = JSON.parse(readFileSync(join(uiOnlyDir, "package.json"), "utf-8")) as {
        scripts?: Record<string, string>;
      };

      expect(readChildWorkspacePackages(uiOnlyDir)).toEqual(["ui"]);
      expect(pkg.scripts?.["db:push"]).toBeUndefined();
      expect(pkg.scripts?.["test:api"]).toBeUndefined();
      expect(pkg.scripts?.["test:e2e"]).toBeUndefined();
      expect(pkg.scripts?.["dev:postgres"]).toBeUndefined();
      expect(pkg.scripts?.["dev:ui"]).toBeDefined();
      expect(pkg.scripts?.["dev:api"]).toBeUndefined();
    } finally {
      rmSync(uiOnlyDir, { recursive: true, force: true });
    }
  });

  it("generated AGENTS.md documents DAO-owned tenants, not legacy subaccount keys", () => {
    const agentsMd = buildChildAgentsMd("", { overrides: ["ui", "api", "host"] });

    expect(agentsMd).not.toContain("NEAR_SUB_ACCOUNT_PARENT_KEY");
    expect(agentsMd).not.toContain("siwn.subAccount.parentAccount");
    expect(agentsMd).toContain("sputnik-dao");
  });
});
