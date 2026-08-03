import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInitPatterns, copyFilteredFiles, personalizeConfig } from "../../src/cli/init";
import { findBosConfigPathInDir, readBosConfigSource } from "../../src/config-source";
import { loadManifestNormalizationSpec } from "../../src/internal/manifest-normalizer";

const REPO_ROOT = join(import.meta.dirname, "../../../../");
const ROOT_CONFIG = JSON.parse(readFileSync(join(REPO_ROOT, "bos.config.json"), "utf-8")) as {
  app?: { api?: { name?: string }; auth?: { shared?: Record<string, unknown> } };
  plugins?: Record<string, { routes?: string[] }>;
};
const MANIFEST_SPEC = loadManifestNormalizationSpec(REPO_ROOT);

function pluginRoutesFromRoot(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(ROOT_CONFIG.plugins ?? {}).map(([key, value]) => [key, value.routes ?? []]),
  );
}

async function scaffoldProject(
  overrides: Array<"ui" | "api" | "host" | "plugins">,
  plugins?: string[],
): Promise<string> {
  const testDir = mkdtempSync(join(tmpdir(), "bos-personalize-"));
  const patterns = buildInitPatterns(overrides, plugins);
  const pluginRoutes = pluginRoutesFromRoot();

  await copyFilteredFiles(REPO_ROOT, testDir, patterns, {
    overrides,
    plugins,
    pluginRoutes,
  });

  await personalizeConfig(testDir, {
    extendsAccount: "dev.everything.near",
    extendsGateway: "everything.dev",
    account: "test.near",
    domain: "test.dev",
    overrides,
    plugins,
    pluginRoutes,
    workspaceOpts: { sourceDir: REPO_ROOT },
  });

  return testDir;
}

describe("personalizeConfig with real root config", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("strips inherited root metadata for init while preserving shared config", async () => {
    const testDir = await scaffoldProject(["ui", "api"]);
    tempDirs.push(testDir);

    const config = JSON.parse(readFileSync(join(testDir, "bos.config.json"), "utf-8")) as {
      account?: string;
      domain?: string;
      extends?: string;
      title?: string;
      description?: string;
      testnet?: string;
      staging?: unknown;
      repository?: string;
      shared?: Record<string, unknown>;
      app?: {
        host?: Record<string, unknown>;
        ui?: Record<string, unknown>;
        api?: Record<string, unknown>;
        auth?: Record<string, unknown>;
      };
      plugins?: Record<string, unknown>;
    };

    expect(config.extends).toBe("bos://dev.everything.near/everything.dev");
    expect(config.account).toBe("test.near");
    expect(config.domain).toBe("test.dev");
    expect(config.title).toBeUndefined();
    expect(config.description).toBeUndefined();
    expect(config.testnet).toBeUndefined();
    expect(config.staging).toBeUndefined();
    expect(config.repository).toBeUndefined();
    expect(config.shared).toBeUndefined();
    expect(config.app?.host).toBeUndefined();
    expect(config.app?.auth).toBeUndefined();
    expect(config.app?.ui?.name).toBeUndefined();
    expect(config.app?.ui?.development).toBe("local:ui");
    expect(config.app?.ui?.production).toBeUndefined();
    expect(config.app?.ui?.integrity).toBeUndefined();
    expect(config.app?.ui?.ssr).toBeUndefined();
    expect(config.app?.ui?.ssrIntegrity).toBeUndefined();
    expect(config.app?.api?.name).toBe(ROOT_CONFIG.app?.api?.name);
    expect(config.app?.api?.development).toBe("local:api");
    expect(config.app?.api?.production).toBeUndefined();
    expect(config.app?.api?.integrity).toBeUndefined();
    expect(config.plugins).toEqual({});
  });

  it("filters plugin config and workspaces to the selected plugin set", async () => {
    const testDir = await scaffoldProject(["ui", "api", "plugins"], ["apps"]);
    tempDirs.push(testDir);

    expect(existsSync(join(testDir, "plugins", "apps"))).toBe(true);
    expect(existsSync(join(testDir, "plugins", "example"))).toBe(false);
    expect(existsSync(join(testDir, "plugins", "example"))).toBe(false);
    expect(existsSync(join(testDir, "ui", "src", "routes", "_layout", "apps", "index.tsx"))).toBe(
      true,
    );
    expect(
      existsSync(join(testDir, "ui", "src", "routes", "_layout", "_authenticated", "example.tsx")),
    ).toBe(false);

    const config = JSON.parse(readFileSync(join(testDir, "bos.config.json"), "utf-8")) as {
      plugins?: Record<string, Record<string, unknown>>;
    };

    expect(Object.keys(config.plugins ?? {})).toEqual(["apps"]);
    expect(config.plugins?.apps?.development).toBe("local:plugins/apps");
    expect(config.plugins?.apps?.production).toBeUndefined();
    expect(config.plugins?.apps?.integrity).toBeUndefined();
  });

  it("rewrites package metadata to the child workspace shape", async () => {
    const testDir = await scaffoldProject(["ui", "api", "plugins"], ["apps"]);
    tempDirs.push(testDir);

    const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      workspaces?: { packages?: string[]; catalog?: Record<string, string> };
    };

    expect(pkg.dependencies?.["everything-dev"]).toBe("catalog:");
    expect(pkg.dependencies?.["every-plugin"]).toBe("catalog:");
    expect(pkg.devDependencies?.["everything-dev"]).toBeUndefined();
    expect(pkg.devDependencies?.["every-plugin"]).toBeUndefined();
    expect(pkg.scripts?.postinstall).toBe("node node_modules/.bin/bos types gen || true");
    expect(pkg.scripts?.["types:gen"]).toBe("node node_modules/.bin/bos types gen");
    expect(pkg.scripts?.bos).toBe("bos");
    expect(pkg.workspaces?.packages).toEqual(expect.arrayContaining(["ui", "api", "plugins/*"]));
    expect(pkg.workspaces?.packages).toHaveLength(3);
    expect(pkg.workspaces?.packages).not.toContain("plugins/apps");
    expect(pkg.workspaces?.packages).not.toContain("host");
    expect(pkg.workspaces?.packages).not.toContain("packages/everything-dev");
    expect(pkg.workspaces?.catalog?.["everything-dev"]).toBe(
      MANIFEST_SPEC.rootCatalog["everything-dev"],
    );
    expect(pkg.workspaces?.catalog?.["every-plugin"]).toBe(
      MANIFEST_SPEC.rootCatalog["every-plugin"],
    );
  });

  it("keeps host when requested while still stripping inherited metadata", async () => {
    const testDir = await scaffoldProject(["ui", "api", "host"]);
    tempDirs.push(testDir);

    const config = JSON.parse(readFileSync(join(testDir, "bos.config.json"), "utf-8")) as {
      title?: string;
      repository?: string;
      app?: { host?: Record<string, unknown>; auth?: Record<string, unknown> };
    };

    expect(config.title).toBeUndefined();
    expect(config.repository).toBeUndefined();
    expect(config.app?.host?.development).toBe("local:host");
    expect(config.app?.host?.production).toBeUndefined();
    expect(config.app?.host?.integrity).toBeUndefined();
    expect(config.app?.auth).toBeUndefined();
  });

  it("preserves an existing child auth override during sync mode", async () => {
    const testDir = await scaffoldProject(["ui", "api"]);
    tempDirs.push(testDir);

    const configPath = join(testDir, "bos.config.json");
    const existingConfig = JSON.parse(readFileSync(configPath, "utf-8")) as {
      app?: Record<string, unknown>;
    };
    existingConfig.app = {
      ...(existingConfig.app ?? {}),
      auth: {
        development: "local:plugins/auth",
        production: "https://auth.child.dev",
      },
    };
    writeFileSync(configPath, `${JSON.stringify(existingConfig, null, 2)}\n`);
    await personalizeConfig(testDir, {
      extendsAccount: "dev.everything.near",
      extendsGateway: "everything.dev",
      account: "test.near",
      domain: "test.dev",
      overrides: ["ui", "api"],
      workspaceOpts: { sourceDir: REPO_ROOT },
      mode: "sync",
      existingConfig,
    });

    const syncedConfig = JSON.parse(readFileSync(configPath, "utf-8")) as {
      app?: { auth?: { development?: string; production?: string } };
    };

    expect(syncedConfig.app?.auth).toEqual({
      development: "local:plugins/auth",
      production: "https://auth.child.dev",
    });
  });

  it("mode=init writes bos.config.toml and cleans up stale json from template copy", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-init-toml-"));
    tempDirs.push(testDir);
    const repoConfig = readFileSync(join(REPO_ROOT, "bos.config.json"), "utf-8");

    writeFileSync(join(testDir, "bos.config.json"), repoConfig);

    await personalizeConfig(testDir, {
      mode: "init",
      extendsAccount: "dev.everything.near",
      extendsGateway: "everything.dev",
      account: "test.near",
      domain: "test.dev",
      overrides: ["ui", "api"],
      workspaceOpts: { sourceDir: REPO_ROOT },
    });

    const configPath = findBosConfigPathInDir(testDir);
    expect(configPath).toBe(join(testDir, "bos.config.toml"));
    expect(configPath).not.toBeNull();
    expect(existsSync(join(testDir, "bos.config.json"))).toBe(false);

    const config = readBosConfigSource(configPath!);
    expect(config.account).toBe("test.near");
    expect(config.domain).toBe("test.dev");
    expect(config.extends).toBe("bos://dev.everything.near/everything.dev");
  });
});
