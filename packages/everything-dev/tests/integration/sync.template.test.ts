vi.mock("../../src/infra/materializer", async () => {
  const actual = await vi.importActual<typeof import("../../src/infra/materializer")>(
    "../../src/infra/materializer",
  );
  // Replace the orchestration helper with a no-op so the file-generation
  // side-effects don't pollute the test's tempdir. The previous test mock
  // targeted writeGeneratedInfra; this is the materializer-equivalent
  // bypass at the orchestration entry point.
  return {
    ...actual,
    materializeViaLayer: async () => {},
  };
});

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import * as initModule from "../../src/cli/init";
import {
  buildInitPatterns,
  copyFilteredFiles,
  personalizeConfig,
  writeInitSnapshot,
} from "../../src/cli/init";
import { readSnapshot } from "../../src/cli/snapshot";
import { syncTemplate } from "../../src/cli/sync";
import * as sessionModule from "../../src/resolution/session";
import { loadParentConfigFixture, writeChildConfigFixture } from "../helpers/parent-config";

const REPO_ROOT = join(import.meta.dirname, "../../../../");
const ROOT_CONFIG = (await loadParentConfigFixture()) as {
  plugins?: Record<string, { routes?: string[] }>;
};

function pluginRoutesFromRoot(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(ROOT_CONFIG.plugins ?? {}).map(([key, value]) => [key, value.routes ?? []]),
  );
}

function runtimePluginsFromRoot(): Record<string, { routes: string[] }> {
  return Object.fromEntries(
    Object.entries(ROOT_CONFIG.plugins ?? {}).map(([key, value]) => [
      key,
      { routes: value.routes ?? [] },
    ]),
  );
}

function fileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 16);
}

async function scaffoldProject(
  overrides: Array<"ui" | "api" | "host" | "plugins">,
  plugins?: string[],
): Promise<string> {
  const projectDir = mkdtempSync(join(tmpdir(), "bos-sync-template-"));
  const patterns = buildInitPatterns(overrides, plugins);
  const pluginRoutes = pluginRoutesFromRoot();

  await copyFilteredFiles(REPO_ROOT, projectDir, patterns, {
    overrides,
    plugins,
    pluginRoutes,
  });

  writeChildConfigFixture(
    projectDir,
    overrides.filter((o) => o !== "plugins") as Array<"host" | "ui" | "api">,
  );

  await personalizeConfig(projectDir, {
    extendsAccount: "dev.everything.near",
    extendsGateway: "everything.dev",
    account: "test.near",
    domain: "test.dev",
    overrides,
    plugins,
    pluginRoutes,
    workspaceOpts: { sourceDir: REPO_ROOT },
  });

  await writeInitSnapshot(
    projectDir,
    "dev.everything.near",
    "everything.dev",
    REPO_ROOT,
    patterns,
    {
      overrides,
      plugins,
      pluginRoutes,
    },
  );

  return projectDir;
}

describe("syncTemplate", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.spyOn(initModule, "resolveSourceDir").mockResolvedValue({
      sourceDir: REPO_ROOT,
      parentConfig: ROOT_CONFIG as never,
      cleanup: async () => {},
    });
    vi.spyOn(sessionModule, "openResolution").mockImplementation(async ({ cwd }) => {
      if (cwd === REPO_ROOT) {
        return { runtime: { plugins: runtimePluginsFromRoot() } } as never;
      }
      return { runtime: { plugins: {} } } as never;
    });
    vi.spyOn(initModule, "runPnpmInstall").mockResolvedValue();
    vi.spyOn(initModule, "runTypesGen").mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("updates framework-owned files and leaves non-framework files alone", async () => {
    const projectDir = await scaffoldProject(["ui", "api", "plugins"], ["registry"]);
    tempDirs.push(projectDir);

    const frameworkOwnedPath = join(projectDir, "ui", "src", "lib", "api.ts");
    const syncOwnedPath = join(projectDir, "ui", "src", "providers", "index.tsx");
    const appOwnedPath = join(projectDir, "ui", "src", "components", "user-nav.tsx");

    writeFileSync(frameworkOwnedPath, "framework override\n");
    writeFileSync(syncOwnedPath, "provider override\n");
    writeFileSync(appOwnedPath, "component override\n");

    const result = await syncTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
    });

    expect(result.status).toBe("synced");
    expect(result.conflicted).not.toContain("ui/src/lib/api.ts");
    expect(result.updated).not.toContain("ui/src/lib/api.ts");
    expect(result.updated).not.toContain("ui/src/providers/index.tsx");
    expect(result.conflicted).not.toContain("ui/src/providers/index.tsx");
    expect(result.updated).not.toContain("ui/src/components/user-nav.tsx");
    expect(result.conflicted).not.toContain("ui/src/components/user-nav.tsx");
    expect(readFileSync(frameworkOwnedPath, "utf-8")).toBe("framework override\n");
    expect(readFileSync(syncOwnedPath, "utf-8")).toBe("provider override\n");
    expect(readFileSync(appOwnedPath, "utf-8")).toBe("component override\n");
  });

  it("delivers config-level ui files but never app-owned ui sources", async () => {
    const projectDir = await scaffoldProject(["ui"]);
    tempDirs.push(projectDir);
    const configFile = "ui/tsconfig.json";
    const appOwned = [
      "ui/src/components/document-fallback.tsx",
      "ui/src/components/root-error.tsx",
      "ui/src/components/root-not-found.tsx",
      "ui/src/components/router-error.tsx",
    ];
    unlinkSync(join(projectDir, configFile));
    for (const file of appOwned) unlinkSync(join(projectDir, file));

    const result = await syncTemplate(projectDir, { dryRun: false, noInstall: true });

    expect(result.status).toBe("synced");
    expect(result.added).toContain(configFile);
    expect(readFileSync(join(projectDir, configFile), "utf-8")).toBe(
      readFileSync(join(REPO_ROOT, configFile), "utf-8"),
    );
    // App-owned ui sources are the child's — sync never re-adds them (ADR 0023).
    for (const file of appOwned) {
      expect(result.added).not.toContain(file);
      expect(existsSync(join(projectDir, file))).toBe(false);
    }
  });

  it("retires stale bootstrap stubs — backed up, then deleted", async () => {
    const projectDir = await scaffoldProject(["ui"]);
    tempDirs.push(projectDir);
    writeFileSync(join(projectDir, "ui", "src", "hydrate.tsx"), "export {};\n");

    const result = await syncTemplate(projectDir, { dryRun: false, noInstall: true });

    expect(result.status).toBe("synced");
    expect(result.retiredConflicted).toContain("ui/src/hydrate.tsx");
    expect(existsSync(join(projectDir, "ui", "src", "hydrate.tsx"))).toBe(false);
    expect(result.backupDir).toBeDefined();
  });

  it("sync does not re-add plugin workspaces because it only manages framework-owned files", async () => {
    const projectDir = await scaffoldProject(["ui", "api", "plugins"], ["registry"]);
    tempDirs.push(projectDir);

    const selectedPluginPackage = join(projectDir, "plugins", "registry", "package.json");
    unlinkSync(selectedPluginPackage);

    const result = await syncTemplate(projectDir, {
      dryRun: true,
      noInstall: true,
    });

    expect(result.status).toBe("dry-run");
    expect(result.added).not.toContain("plugins/registry/package.json");
    expect(result.added).not.toContain("plugins/example/package.json");
  });

  it("preserves child root metadata and prunes stale local plugin entries during sync", async () => {
    const projectDir = await scaffoldProject(["ui", "api", "plugins"], ["registry"]);
    tempDirs.push(projectDir);

    const configPath = join(projectDir, "bos.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      title?: string;
      repository?: string;
      description?: string;
      plugins?: Record<string, Record<string, unknown>>;
    };

    config.title = "child app";
    config.repository = "https://github.com/example/child-app";
    config.plugins = {
      ...config.plugins,
      example: {
        development: "local:plugins/example",
      },
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = await syncTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
    });

    expect(result.status).toBe("synced");

    const syncedConfig = JSON.parse(readFileSync(configPath, "utf-8")) as {
      title?: string;
      repository?: string;
      description?: string;
      plugins?: Record<string, Record<string, unknown>>;
    };

    expect(syncedConfig.title).toBe("child app");
    expect(syncedConfig.repository).toBe("https://github.com/example/child-app");
    expect(syncedConfig.description).toBeUndefined();
    expect(Object.keys(syncedConfig.plugins ?? {})).toEqual(["registry"]);
  });

  it("syncs GitHub workflow files from .github/templates for child projects", async () => {
    const projectDir = await scaffoldProject(["ui", "api"], []);
    tempDirs.push(projectDir);

    const result = await syncTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
    });

    expect(result.status).toBe("synced");

    const childPublishWorkflow = readFileSync(
      join(projectDir, ".github", "workflows", "deploy.yml"),
      "utf-8",
    );
    const templatePublishWorkflow = readFileSync(
      join(REPO_ROOT, ".github", "templates", "workflows", "deploy.yml"),
      "utf-8",
    );

    expect(childPublishWorkflow).toBe(templatePublishWorkflow);
  });

  it("keeps the plugins workspace override when no child plugins are selected", async () => {
    const projectDir = await scaffoldProject(["ui", "api", "plugins"], []);
    tempDirs.push(projectDir);

    const result = await syncTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
    });

    expect(result.status).toBe("synced");

    const wsDoc = parseYaml(readFileSync(join(projectDir, "pnpm-workspace.yaml"), "utf-8")) as {
      packages?: string[];
    };
    const config = JSON.parse(readFileSync(join(projectDir, "bos.config.json"), "utf-8")) as {
      plugins?: Record<string, unknown>;
    };

    expect(wsDoc.packages).toContain("plugins/*");
    expect(config.plugins).toEqual({});
  });

  it("records sync snapshots using the final merged file content", async () => {
    const projectDir = await scaffoldProject(["ui", "api"], []);
    tempDirs.push(projectDir);

    const packageJsonPath = join(projectDir, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    packageJson.scripts = {
      ...packageJson.scripts,
      custom: "bun run custom",
    };
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const result = await syncTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
    });

    expect(result.status).toBe("synced");

    const snapshot = await readSnapshot(projectDir);
    const finalPackageJson = readFileSync(packageJsonPath, "utf-8");

    expect(snapshot?.files["package.json"]).toBe(fileHash(finalPackageJson));
  });
});
