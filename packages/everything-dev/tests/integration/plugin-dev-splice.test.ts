import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as platformManifestModule from "../../src/services/platform/manifest";
import * as initSourceModule from "../../src/services/resolution/init-source";
import * as sessionModule from "../../src/services/resolution/session";
import * as scaffoldInitModule from "../../src/services/scaffold/init";
import * as scaffoldSnapshotModule from "../../src/services/scaffold/snapshot";
import { syncTemplate } from "../../src/services/scaffold/sync";
import { computeSnapshotHash } from "../../src/utils/snapshot-hash";
import { loadParentConfigFixture } from "../helpers/parent-config";

vi.mock("../../src/infra/materializer", async () => {
  const actual = await vi.importActual<typeof import("../../src/infra/materializer")>(
    "../../src/infra/materializer",
  );
  return { ...actual, materializeViaLayer: async () => {} };
});

const REPO_ROOT = join(import.meta.dirname, "../../../../");
const ROOT_CONFIG = (await loadParentConfigFixture()) as {
  plugins?: Record<string, { routes?: string[] }>;
};

describe("syncTemplate — api/plugin.dev.ts child-owned variables (#538)", () => {
  let projectDir: string | null = null;

  beforeEach(() => {
    vi.spyOn(platformManifestModule, "resolvePlatformManifest").mockResolvedValue({
      manifest: { frameworkVersion: "0.0.0-test" },
    } as never);
    vi.spyOn(initSourceModule, "resolveSourceDir").mockResolvedValue({
      sourceDir: REPO_ROOT,
      parentConfig: ROOT_CONFIG as never,
      cleanup: async () => {},
    });
    vi.spyOn(sessionModule, "openResolution").mockImplementation(async () => {
      return { runtime: { plugins: {} } } as never;
    });
    vi.spyOn(scaffoldInitModule, "runPnpmInstall").mockResolvedValue();
    vi.spyOn(scaffoldInitModule, "runTypesGen").mockResolvedValue();
  });

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
      projectDir = null;
    }
    vi.restoreAllMocks();
  });

  it("a template re-download keeps the child's marked variables and records no conflict", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "bos-sync-plugin-dev-"));

    writeFileSync(
      join(projectDir, "bos.app.ts"),
      `const config = {
  name: "test.dev",
  extends: "bos://dev.everything.near/everything.dev",
  account: "test.near",
  domain: "test.dev",
  api: {
    development: "local:api",
    secrets: ["API_DATABASE_URL"],
  },
  plugins: {},
};
export default config;
`,
    );

    const devPath = join(projectDir, "api", "plugin.dev.ts");
    mkdirSync(join(projectDir, "api"), { recursive: true });
    const template = readFileSync(join(REPO_ROOT, ".github/templates/api/plugin.dev.ts"), "utf-8");

    // The child authors dev variables between the child-owned markers.
    const edited = template.replace(
      /\n {4}variables: \{\},\n/,
      '\n    variables: { domain: "child.app" },\n',
    );
    writeFileSync(devPath, edited);
    expect(edited).toContain("// child-owned-start");

    // Pretend the last sync reconciled exactly this content: the snapshot
    // records the hash of the child-edited file.
    await scaffoldSnapshotModule.writeSnapshot(projectDir, {
      parentRef: "bos://dev.everything.near/everything.dev",
      files: {
        "api/plugin.dev.ts": computeSnapshotHash(readFileSync(devPath, "utf-8")),
      },
    });

    const result = await syncTemplate(projectDir, { dryRun: false, noInstall: true });

    expect(result.status).toBe("synced");
    expect(result.updated).not.toContain("api/plugin.dev.ts");
    expect(result.conflicted).not.toContain("api/plugin.dev.ts");

    const after = readFileSync(devPath, "utf-8");
    expect(after).toContain('variables: { domain: "child.app" },');
    expect(after).toContain("// child-owned-start");
    expect(after).toContain("// child-owned-end");
  });
});
