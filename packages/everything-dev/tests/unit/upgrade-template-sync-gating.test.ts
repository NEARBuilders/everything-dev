import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findCommandDescriptor } from "../../src/cli/catalog";
import { parseCommandInput } from "../../src/cli/parse";
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
  it("same framework version with the pin stamped → framework-owned files are never reconciled", async () => {
    const syncTemplateSpy = mockSyncTemplate();
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
    expect(result.sync).toBeUndefined();
    // the platform pin is already current — only the package migration may move
    expect(result.migrated).not.toContain("bos.config.json");
    expect(syncTemplateSpy).not.toHaveBeenCalled();
  });

  it("unpinned tree → the migration phase reconciles and stamps the pin", async () => {
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
    // no pin on disk — the tree never recorded the release it sits on, so the
    // migration phase runs (the delta is derived, not passed); the parent
    // preflights the template sync first, the child reconciles
    expect(result.sync).toBeDefined();
    expect(syncTemplateSpy).toHaveBeenCalledTimes(2);
    expect(syncTemplateSpy.mock.calls[0]?.[1]?.dryRun).toBe(true);
    expect(syncTemplateSpy.mock.calls[1]?.[1]?.dryRun).toBe(false);
    expect(result.migrated).toContain("bos.config.json");
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
    // package. The delta is derived from the pin-vs-manifest durable state —
    // no version-shaped flag crosses the boundary (`--from` is the v1-train
    // selector only).
    const childArgs = vi.mocked(spawnSync).mock.calls[0]?.[1] ?? [];
    expect(childArgs).toEqual(["upgrade", "--migrations-only", "--no-install", "--json"]);
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
    // --force rides the re-exec boundary; no version flag does
    const childArgs = vi.mocked(spawnSync).mock.calls[0]?.[1] ?? [];
    expect(childArgs).toContain("--force");
    expect(childArgs).not.toContain("--from");
  });

  it("--migrations-only completes pending work when the pin lags", async () => {
    vi.spyOn(platformManifestModule, "resolvePlatformManifest").mockResolvedValue(
      makeManifest("3.0.0", {
        "everything-dev": "^3.0.0",
        "every-plugin": "^2.0.0",
      }) as never,
    );
    const syncTemplateSpy = mockSyncTemplate();
    const projectDir = makeProjectDir({
      "everything-dev": "^3.0.0",
      "every-plugin": "^2.0.0",
    });

    const result = await upgradeTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
      noSync: false,
      migrationsOnly: true,
    });

    expect(result.status).toBe("upgraded");
    // packages already sit on the release; the pin is absent — the derived
    // delta drives the pending migration (the half-upgraded-tree repair)
    expect(result.sync).toBeDefined();
    expect(syncTemplateSpy).toHaveBeenCalledTimes(1);
    expect(syncTemplateSpy.mock.calls[0]?.[1]?.dryRun).toBe(false);
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
  });

  it("--migrations-only on an aligned tree stays a true no-op (no sync)", async () => {
    vi.spyOn(platformManifestModule, "resolvePlatformManifest").mockResolvedValue(
      makeManifest("3.0.0", {
        "everything-dev": "^3.0.0",
        "every-plugin": "^2.0.0",
      }) as never,
    );
    const syncTemplateSpy = mockSyncTemplate();
    const projectDir = makeProjectDir(
      {
        "everything-dev": "^3.0.0",
        "every-plugin": "^2.0.0",
      },
      "3.0.0",
    );

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

  it("the re-exec'd child args parse through the real CLI parser (the #505 regression)", () => {
    const args = ["upgrade", "--migrations-only", "--no-install", "--json"];
    const found = findCommandDescriptor(args);
    if (!found) throw new Error("upgrade command missing from the CLI catalog");
    const input = parseCommandInput(found.descriptor, args.slice(found.consumed)) as Record<
      string,
      unknown
    >;
    expect(input).toMatchObject({ migrationsOnly: true, noInstall: true, json: true });

    // The regression the old re-exec shipped: it carried the pre-upgrade
    // framework version through `--from` — the same flag the v1 train
    // narrowed to enum(["v1"]) — and the child crashed parsing it
    // (invalid_value on from). Unless the v1 selector changes shape, a
    // version string must stay off that flag.
    const withFrom = ["upgrade", "--migrations-only", "--from", "^2.0.0"];
    const fromFound = findCommandDescriptor(withFrom);
    if (!fromFound) throw new Error("upgrade command missing from the CLI catalog");
    expect(() =>
      parseCommandInput(fromFound.descriptor, withFrom.slice(fromFound.consumed)),
    ).toThrow();
  });
});
