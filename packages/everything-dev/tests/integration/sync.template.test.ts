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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
// eslint-disable
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  buildInitPatterns,
  copyFilteredFiles,
  personalizeConfig,
  writeInitSnapshot,
} from "../../src/cli/init";
import { readSnapshot } from "../../src/cli/snapshot";
import * as platformManifestModule from "../../src/services/platform/manifest";
import * as initSourceModule from "../../src/services/resolution/init-source";
import { loadInProcessDescriptor } from "../../src/services/resolution/load";
import * as sessionModule from "../../src/services/resolution/session";
import * as scaffoldInitModule from "../../src/services/scaffold/init";
import { syncTemplate } from "../../src/services/scaffold/sync";
import { loadParentConfigFixture, writeChildAppDescriptorFixture } from "../helpers/parent-config";

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

  writeChildAppDescriptorFixture(
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
    // A pinned child always resolves a release; the release ref-rewriting
    // (ADR 0034) has its own unit coverage (platform-sync-release.test.ts),
    // so a stable manifest is injected and templates sync verbatim here.
    vi.spyOn(platformManifestModule, "resolvePlatformManifest").mockResolvedValue({
      manifest: platformManifestModule.composePlatformReleaseManifest({
        frameworkVersion: "9.9.9-test",
        everyPluginVersion: "9.9.9-test",
        imageRef: "ghcr.io/nearbuilders/everything-dev",
        catalog: {},
        templateInventory: [],
        compatMinChild: "9.9.9-test",
      }),
      source: { account: "dev.everything.near", gateway: "everything.dev" },
      fromCache: false,
    } as never);
    vi.spyOn(initSourceModule, "resolveSourceDir").mockResolvedValue({
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
    vi.spyOn(scaffoldInitModule, "runPnpmInstall").mockResolvedValue();
    vi.spyOn(scaffoldInitModule, "runTypesGen").mockResolvedValue();
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

  it("refuses atomically when a hand-edit conflicts with a template change", async () => {
    const projectDir = await scaffoldProject(["ui", "api"]);
    tempDirs.push(projectDir);

    const parentFixture = mkdtempSync(join(tmpdir(), "bos-sync-parent-conflict-"));
    tempDirs.push(parentFixture);
    mkdirSync(join(parentFixture, "api"), { recursive: true });
    writeFileSync(
      join(parentFixture, "bos.config.json"),
      `${JSON.stringify({ account: "dev.everything.near", domain: "everything.dev" }, null, 2)}\n`,
    );
    // The template's biome.json changed since the child's snapshot —
    // and the child hand-edited its local copy on top of that.
    const conflictedTemplate = `{"template": "reformed"}\n`;
    writeFileSync(join(parentFixture, "biome.json"), conflictedTemplate);
    const childEdits = `{ "local": "hand-edit" }\n`;
    writeFileSync(join(projectDir, "biome.json"), childEdits);
    const pristineSnapshot = readFileSync(join(projectDir, "api", "tsconfig.json"), "utf-8");

    initSourceModule.resolveSourceDir.mockResolvedValue({
      sourceDir: parentFixture,
      parentConfig: { account: "dev.everything.near", domain: "everything.dev" } as never,
      cleanup: async () => {},
    });

    const result = await syncTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicted).toContain("biome.json");
    expect(result.error).toBeDefined();
    expect(result.backupDir).toBeUndefined();
    // All-or-nothing: untouched siblings are pristine, the conflicted file
    // keeps the child's hand-edit, and no template bytes landed anywhere.
    expect(readFileSync(join(projectDir, "biome.json"), "utf-8")).toBe(childEdits);
    expect(readFileSync(join(projectDir, "api", "tsconfig.json"), "utf-8")).toBe(pristineSnapshot);
    expect(existsSync(join(projectDir, ".bos", "sync-backup"))).toBe(false);
  });

  it("with force the template wins and the child fork is backed up", async () => {
    const projectDir = await scaffoldProject(["ui", "api"]);
    tempDirs.push(projectDir);

    const parentFixture = mkdtempSync(join(tmpdir(), "bos-sync-parent-force-"));
    tempDirs.push(parentFixture);
    mkdirSync(join(parentFixture, "api"), { recursive: true });
    writeFileSync(
      join(parentFixture, "bos.config.json"),
      `${JSON.stringify({ account: "dev.everything.near", domain: "everything.dev" }, null, 2)}\n`,
    );
    // loadManifestNormalizationSpec resolves framework versions from the
    // parent tree — its own packages/ members or the workspace catalog.
    writeFileSync(
      join(parentFixture, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - api",
        "catalog:",
        "  every-plugin: 3.0.0-rc.10",
        "  everything-dev: 2.0.0-rc.15",
        "",
      ].join("\n"),
    );
    const conflictedTemplate = `{"template": "reformed"}\n`;
    writeFileSync(join(parentFixture, "biome.json"), conflictedTemplate);
    const childEdits = `{ "local": "hand-edit" }\n`;
    writeFileSync(join(projectDir, "biome.json"), childEdits);

    initSourceModule.resolveSourceDir.mockResolvedValue({
      sourceDir: parentFixture,
      parentConfig: { account: "dev.everything.near", domain: "everything.dev" } as never,
      cleanup: async () => {},
    });

    const result = await syncTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
      force: true,
    });

    expect(result.status).toBe("synced");
    expect(result.conflicted).toContain("biome.json");
    expect(readFileSync(join(projectDir, "biome.json"), "utf-8")).toBe(conflictedTemplate);
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

  it("preserves the child's authored fields across sync (ADR 0032/0033)", async () => {
    const projectDir = await scaffoldProject(["ui", "api", "plugins"], ["registry"]);
    tempDirs.push(projectDir);

    const result = await syncTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
    });

    expect(result.status).toBe("synced");

    const synced = (await loadInProcessDescriptor(
      readFileSync(join(projectDir, "bos.app.ts"), "utf-8"),
      "bos.app.ts",
    )) as {
      extends?: string;
      account?: string;
      domain?: string;
      plugins?: Record<string, Record<string, unknown>>;
    };
    expect(synced.extends).toBe("bos://dev.everything.near/everything.dev");
    expect(synced.account).toBe("test.near");
    expect(synced.domain).toBe("test.dev");
    expect(Object.keys(synced.plugins ?? {})).toEqual(["registry"]);
    expect(synced.plugins?.registry?.development).toBe("local:plugins/registry");
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

    // Release-scoped (ADR 0034): the framework's reusable-workflow refs pin to
    // the resolved release tag, not @main.
    expect(childPublishWorkflow).toBe(
      templatePublishWorkflow.replace(
        "consumer-deploy.yml@main",
        "consumer-deploy.yml@v9.9.9-test",
      ),
    );

    const childCiWorkflow = readFileSync(
      join(projectDir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    const templateCiWorkflow = readFileSync(
      join(REPO_ROOT, ".github", "templates", "workflows", "ci.yml"),
      "utf-8",
    );

    expect(childCiWorkflow).toBe(
      templateCiWorkflow.replace("consumer-ci.yml@main", "consumer-ci.yml@v9.9.9-test"),
    );
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
    const descriptor = (await loadInProcessDescriptor(
      readFileSync(join(projectDir, "bos.app.ts"), "utf-8"),
      "bos.app.ts",
    )) as {
      plugins?: Record<string, unknown>;
    };

    expect(wsDoc.packages).toContain("plugins/*");
    // No child plugins selected — the authored descriptor carries no plugin
    // entries (an emptied record serializes as absent).
    expect(descriptor.plugins ?? {}).toEqual({});
  });

  it("records sync snapshots using the final merged file content", async () => {
    const projectDir = await scaffoldProject(["ui", "api"], []);
    tempDirs.push(projectDir);

    const packageJsonPath = join(projectDir, "package.json");

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
