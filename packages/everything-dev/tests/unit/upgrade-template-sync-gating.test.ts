import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upgradeTemplate } from "../../src/cli/upgrade";
import * as platformManifestModule from "../../src/services/platform/manifest";
import * as initSourceModule from "../../src/services/resolution/init-source";
import * as sessionModule from "../../src/services/resolution/session";
import * as initModule from "../../src/services/scaffold/init";
import * as syncModule from "../../src/services/scaffold/sync";
import * as sharedDepsModule from "../../src/services/workspace/shared-deps";

const tempDirs: string[] = [];

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn(),
  };
});

function makeManifest(frameworkVersion: string, catalog: Record<string, string>) {
  return {
    manifest: platformManifestModule.composePlatformReleaseManifest({
      frameworkVersion,
      everyPluginVersion: frameworkVersion,
      imageRef: "ghcr.io/nearbuilders/everything-dev",
      catalog,
      templateInventory: [],
      compatMinChild: frameworkVersion,
    }),
    source: { account: "dev.everything.near", gateway: "everything.dev" },
    fromCache: false,
  };
}

beforeEach(() => {
  // The gate under test is the child's platform pin (ADR 0034) — the manifest
  // is injected, never fetched.
  vi.spyOn(platformManifestModule, "resolvePlatformManifest").mockResolvedValue(
    makeManifest("2.0.0", {
      "everything-dev": "^2.0.0",
      "every-plugin": "^2.0.0",
    }) as never,
  );
  // The chain walk fetches the published parent config — mock it.
  vi.spyOn(initSourceModule, "fetchParentConfig").mockResolvedValue({
    repository: "https://github.com/NEARBuilders/everything-dev",
  } as never);
  // The migration phase opens a resolution session for the project's own
  // config; mock it (the syncResolvedSharedDeps consumer only needs `.config`).
  vi.spyOn(sessionModule, "openResolution").mockResolvedValue({
    config: { account: "test.near", domain: "test.dev" },
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
  const spawnSyncMock = vi.mocked(spawnSync);
  spawnSyncMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeProjectDir(catalog: Record<string, string>, platform?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-sync-gating-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "ui"), { recursive: true });

  writeFileSync(
    join(dir, "bos.config.json"),
    `${JSON.stringify({
      extends: "bos://dev.everything.near/everything.dev",
      account: "test.near",
      domain: "test.dev",
      ...(platform ? { platform } : {}),
      app: { ui: { development: "local:ui" } },
    })}\n`,
  );

  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: {
        packages: ["ui"],
        catalog,
      },
      dependencies: {
        "everything-dev": "catalog:",
        "every-plugin": "catalog:",
      },
    })}\n`,
  );

  writeFileSync(join(dir, "ui", "package.json"), `${JSON.stringify({ name: "ui" })}\n`);

  return dir;
}

function mockSyncTemplate(result?: Partial<Record<string, unknown>>) {
  return vi.spyOn(syncModule, "syncTemplate").mockResolvedValue({
    status: "synced",
    updated: [],
    skipped: [],
    added: [],
    conflicted: [],
    ...result,
  } as never);
}

describe("upgradeTemplate template-sync gating (ADR 0032/0034)", () => {
  it("same framework version → framework-owned files are never reconciled", async () => {
    const syncTemplateSpy = mockSyncTemplate();
    const projectDir = makeProjectDir({
      "everything-dev": "^2.0.0",
      "every-plugin": "^2.0.0",
    });

    const result = await upgradeTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
      noSync: false,
    });

    expect(result.status).toBe("upgraded");
    expect(result.sync).toBeUndefined();
    // the platform pin is stamped (or kept) even without a version delta
    expect(result.migrated).toContain("bos.config.json");
    expect(syncTemplateSpy).not.toHaveBeenCalled();
  });

  it("same framework version with the pin already stamped → nothing migrated", async () => {
    mockSyncTemplate();
    const projectDir = makeProjectDir(
      {
        "everything-dev": "^2.0.0",
        "every-plugin": "^2.0.0",
      },
      "2.0.0",
    );

    const result = await upgradeTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
      noSync: false,
    });

    expect(result.status).toBe("upgraded");
    // the pin is already current — only the package migration may move
    expect(result.migrated).not.toContain("bos.config.json");
  });

  it("framework version change → preflight dry-run then the re-exec'd migration reconciles", async () => {
    vi.spyOn(platformManifestModule, "resolvePlatformManifest").mockResolvedValue(
      makeManifest("3.0.0", {
        "everything-dev": "^3.0.0",
        "every-plugin": "^2.0.0",
      }) as never,
    );
    const syncTemplateSpy = mockSyncTemplate();
    const projectDir = makeProjectDir({
      "everything-dev": "^2.0.0",
      "every-plugin": "^2.0.0",
    });
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ status: "upgraded", packages: [], timings: [] }),
      stderr: "",
    } as never);

    const result = await upgradeTemplate(projectDir, {
      dryRun: false,
      noInstall: false,
      noSync: false,
    });

    expect(result.status).toBe("upgraded");
    // the preflight dry-run ran through the same syncTemplate; the
    // reconciling sync itself runs in the re-exec'd child process
    expect(syncTemplateSpy).toHaveBeenCalledTimes(1);
    expect(syncTemplateSpy.mock.calls[0]?.[1]?.dryRun).toBe(true);
    // Phase 1 installed, so the migration phase re-execs from the new
    // package, carrying `--from` across the boundary
    const childArgs = vi.mocked(spawnSync).mock.calls[0]?.[1] ?? [];
    expect(childArgs).toContain("--from");
    expect(childArgs).toContain("^2.0.0");
    expect(childArgs).toContain("--migrations-only");
  });

  it("preflight conflict aborts before any package applies", async () => {
    vi.spyOn(platformManifestModule, "resolvePlatformManifest").mockResolvedValue(
      makeManifest("3.0.0", {
        "everything-dev": "^3.0.0",
        "every-plugin": "^2.0.0",
      }) as never,
    );
    mockSyncTemplate({
      status: "conflicted",
      conflicted: ["biome.json"],
      error: "Local edits conflict with the upstream template",
    });
    const projectDir = makeProjectDir({
      "everything-dev": "^2.0.0",
      "every-plugin": "^2.0.0",
    });

    const result = await upgradeTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
      noSync: false,
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("bos upgrade --force");
    expect(result.error).toContain("biome.json");
    // nothing was applied — no re-exec, no install side effects
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
  });

  it("--force bypasses the preflight and lets the migration sync overwrite", async () => {
    vi.spyOn(platformManifestModule, "resolvePlatformManifest").mockResolvedValue(
      makeManifest("3.0.0", {
        "everything-dev": "^3.0.0",
        "every-plugin": "^2.0.0",
      }) as never,
    );
    const syncTemplateSpy = mockSyncTemplate();
    const projectDir = makeProjectDir({
      "everything-dev": "^2.0.0",
      "every-plugin": "^2.0.0",
    });
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ status: "upgraded", packages: [], timings: [] }),
      stderr: "",
    } as never);

    const result = await upgradeTemplate(projectDir, {
      dryRun: false,
      noInstall: false,
      noSync: false,
      force: true,
    });

    expect(result.status).toBe("upgraded");
    // no preflight; the reconciling sync runs in the re-exec'd child
    expect(syncTemplateSpy).not.toHaveBeenCalled();
    // --force rides the re-exec boundary
    const childArgs = vi.mocked(spawnSync).mock.calls[0]?.[1] ?? [];
    expect(childArgs).toContain("--force");
  });

  it("--migrations-only without --from is a deliberate no-op (no sync)", async () => {
    vi.spyOn(platformManifestModule, "resolvePlatformManifest").mockResolvedValue(
      makeManifest("3.0.0", {
        "everything-dev": "^3.0.0",
        "every-plugin": "^2.0.0",
      }) as never,
    );
    const syncTemplateSpy = mockSyncTemplate();
    const projectDir = makeProjectDir({
      "everything-dev": "^2.0.0",
      "every-plugin": "^2.0.0",
    });

    const result = await upgradeTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
      noSync: false,
      migrationsOnly: true,
    });

    expect(result.status).toBe("upgraded");
    expect(result.sync).toBeUndefined();
    expect(syncTemplateSpy).not.toHaveBeenCalled();
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
  });
});
