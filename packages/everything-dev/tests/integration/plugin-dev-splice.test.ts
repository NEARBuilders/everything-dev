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
const TEMPLATE_PATH = join(REPO_ROOT, ".github/templates/api/plugin.dev.ts");
const DEV_DEST = "api/plugin.dev.ts";

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

  function createSyncProject(localPluginDevTs: string): string {
    const dir = mkdtempSync(join(tmpdir(), "bos-sync-plugin-dev-"));
    writeFileSync(
      join(dir, "bos.app.ts"),
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
    mkdirSync(join(dir, "api"), { recursive: true });
    // withApi detection keys on api/package.json; a minimal manifest keeps the
    // api/* inventory entries in scope.
    writeFileSync(
      join(dir, "api", "package.json"),
      `${JSON.stringify({ name: "api", version: "0.0.0", private: true }, null, 2)}\n`,
    );
    writeFileSync(join(dir, DEV_DEST), localPluginDevTs);
    projectDir = dir;
    return dir;
  }

  async function seedReconciledSnapshot(devPath: string): Promise<void> {
    await scaffoldSnapshotModule.writeSnapshot(projectDir!, {
      parentRef: "bos://dev.everything.near/everything.dev",
      files: {
        [DEV_DEST]: computeSnapshotHash(readFileSync(devPath, "utf-8")),
      },
    });
  }

  it("a template re-download keeps the child's marked variables and records no conflict", async () => {
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const edited = template.replace(
      /\n {4}variables: \{\},\n/,
      '\n    variables: { domain: "child.app" },\n',
    );
    expect(edited).toContain("// child-owned-start");
    const dir = createSyncProject(edited);

    // Pretend the last sync reconciled exactly this content: the snapshot
    // records the hash of the child-edited file.
    await seedReconciledSnapshot(join(dir, DEV_DEST));

    const result = await syncTemplate(dir, { dryRun: false, noInstall: true });

    expect(result.status).toBe("synced");
    expect(result.updated).not.toContain(DEV_DEST);
    expect(result.conflicted).not.toContain(DEV_DEST);

    const after = readFileSync(join(dir, DEV_DEST), "utf-8");
    expect(after).toContain('variables: { domain: "child.app" },');
    expect(after).toContain("// child-owned-start");
    expect(after).toContain("// child-owned-end");
  });

  it("template bytes outside the markers are refreshed while the child's span survives", async () => {
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    // An older release's framework bytes: stale header text outside the span.
    const oldBase = template.replace(
      "reconciled from the parent template by `bos upgrade`",
      "reconciled by the template walk",
    );
    expect(oldBase).not.toBe(template);
    const childCopy = oldBase.replace(
      "    variables: {},",
      '    variables: { domain: "child.app" },',
    );
    const dir = createSyncProject(childCopy);
    await seedReconciledSnapshot(join(dir, DEV_DEST));

    const result = await syncTemplate(dir, { dryRun: false, noInstall: true });

    expect(result.status).toBe("synced");
    expect(result.updated).toContain(DEV_DEST);
    expect(result.conflicted).not.toContain(DEV_DEST);

    const after = readFileSync(join(dir, DEV_DEST), "utf-8");
    expect(after).toContain('variables: { domain: "child.app" },');
    expect(after).toContain("reconciled from the parent template by `bos upgrade`");
    expect(after).not.toContain("reconciled by the template walk");
    const start = after.indexOf("// child-owned-start");
    const end = after.indexOf("// child-owned-end");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("a marker-less (pre-#538) local copy migrates its variables onto the protocol", async () => {
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const legacy = template
      .replace("    // child-owned-start\n", "")
      .replace("    // child-owned-end\n", "")
      .replace("    variables: {},", '    variables: { domain: "legacy.app" },');
    expect(legacy).not.toContain("// child-owned-start");
    const dir = createSyncProject(legacy);
    await seedReconciledSnapshot(join(dir, DEV_DEST));

    const result = await syncTemplate(dir, { dryRun: false, noInstall: true });

    expect(result.status).toBe("synced");
    expect(result.updated).toContain(DEV_DEST);
    expect(result.conflicted).not.toContain(DEV_DEST);

    const after = readFileSync(join(dir, DEV_DEST), "utf-8");
    const start = after.indexOf("// child-owned-start");
    const variables = after.indexOf('variables: { domain: "legacy.app" },');
    const end = after.indexOf("// child-owned-end");
    expect(start).toBeGreaterThan(-1);
    expect(variables).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(variables);
  });

  it("a hand-edited ci-child.yml is untouched by sync (blessed child-owned workflow)", async () => {
    const dir = createSyncProject(readFileSync(TEMPLATE_PATH, "utf-8"));
    await seedReconciledSnapshot(join(dir, DEV_DEST));

    const childCiPath = join(dir, ".github", "workflows", "ci-child.yml");
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    const custom = [
      "name: Child CI",
      "on: workflow_call",
      "jobs:",
      "  browser-tests:",
      "    runs-on: ubuntu-24.04",
      "    steps:",
      '      - run: echo "child-owned"',
      "",
    ].join("\n");
    writeFileSync(childCiPath, custom);

    const result = await syncTemplate(dir, { dryRun: false, noInstall: true });

    expect(result.status).toBe("synced");
    expect(result.updated).not.toContain(".github/workflows/ci-child.yml");
    expect(result.conflicted).not.toContain(".github/workflows/ci-child.yml");
    expect(result.added).not.toContain(".github/workflows/ci-child.yml");
    expect(readFileSync(childCiPath, "utf-8")).toBe(custom);
  });
});
