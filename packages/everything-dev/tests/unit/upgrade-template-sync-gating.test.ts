import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { upgradeTemplate } from "../../src/cli/upgrade";
import * as initSourceModule from "../../src/services/resolution/init-source";
import * as syncModule from "../../src/services/scaffold/sync";
import * as sharedDepsModule from "../../src/services/workspace/shared-deps";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeProjectDir(catalog: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-sync-gating-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "ui"), { recursive: true });

  writeFileSync(
    join(dir, "bos.config.json"),
    `${JSON.stringify({
      extends: "bos://dev.everything.near/everything.dev",
      account: "test.near",
      domain: "test.dev",
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

function mockParentSource(catalog: Record<string, string>) {
  vi.spyOn(initSourceModule, "fetchParentConfig").mockResolvedValue({
    repository: "https://github.com/NEARBuilders/everything-dev",
  } as never);
  vi.spyOn(initSourceModule, "resolveCatalogChainSource").mockResolvedValue({
    catalog,
    repository: "https://github.com/NEARBuilders/everything-dev",
    extendsChain: ["bos://dev.everything.near/everything.dev"],
  } as never);
  vi.spyOn(sharedDepsModule, "syncResolvedSharedDeps").mockResolvedValue({
    mode: "bos->catalog",
    hostMode: "local",
    bosConfigChanged: false,
    catalogChanged: false,
    generatedChanged: false,
    resolved: { deps: {}, fingerprintSha256: "" },
  } as never);
}

function mockSyncTemplate() {
  return vi.spyOn(syncModule, "syncTemplate").mockResolvedValue({
    status: "synced",
    updated: [],
    skipped: [],
    added: [],
    conflicted: [],
  } as never);
}

describe("upgradeTemplate template-sync gating (ADR 0032)", () => {
  it("same framework version → framework-owned files are never reconciled", async () => {
    mockParentSource({
      "everything-dev": "^2.0.0",
      "every-plugin": "^2.0.0",
    });
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
    expect(syncTemplateSpy).not.toHaveBeenCalled();
  });

  it("framework version change → the migration phase reconciles template files", async () => {
    mockParentSource({
      "everything-dev": "^3.0.0",
      "every-plugin": "^2.0.0",
    });
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
    expect(syncTemplateSpy).toHaveBeenCalledTimes(1);
  });
});
