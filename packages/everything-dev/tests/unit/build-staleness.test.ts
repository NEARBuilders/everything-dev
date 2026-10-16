import {
  mkdirSync,
  mkdtempSync,
  mkdtempSync as mkTmp,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentHashStalenessOracle,
  isWorkspaceDistStale,
  type WorkspaceMember,
} from "../../src/workspace";

const tmpDirs: string[] = [];

function makePackageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dist-staleness-"));
  tmpDirs.push(dir);
  mkdirSync(join(dir, "src", "nested"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ module: "dist/index.mjs" })}\n`);
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  writeFileSync(join(dir, "src", "nested", "deep.ts"), "export {};\n");
  writeFileSync(join(dir, "dist", "index.mjs"), "export {};\n");
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("isWorkspaceDistStale", () => {
  it("is stale when the dist entry is missing", async () => {
    const dir = makePackageDir();
    rmSync(join(dir, "dist", "index.mjs"));

    expect(await isWorkspaceDistStale(dir, "dist/index.mjs")).toBe(true);
  });

  it("is fresh when dist was built after all sources", async () => {
    const dir = makePackageDir();
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, "dist", "index.mjs"), future, future);

    expect(await isWorkspaceDistStale(dir, "dist/index.mjs")).toBe(false);
  });

  it("is stale when a nested source file is newer than dist", async () => {
    const dir = makePackageDir();
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, "dist", "index.mjs"), future, future);
    const newer = new Date(Date.now() + 120_000);
    utimesSync(join(dir, "src", "nested", "deep.ts"), newer, newer);

    expect(await isWorkspaceDistStale(dir, "dist/index.mjs")).toBe(true);
  });

  it("is stale when package.json is newer than dist", async () => {
    const dir = makePackageDir();
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, "dist", "index.mjs"), future, future);
    const newer = new Date(Date.now() + 120_000);
    utimesSync(join(dir, "package.json"), newer, newer);

    expect(await isWorkspaceDistStale(dir, "dist/index.mjs")).toBe(true);
  });

  it("ignores node_modules and dist while scanning sources", async () => {
    const dir = makePackageDir();
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, "dist", "index.mjs"), future, future);
    mkdirSync(join(dir, "node_modules", "some-pkg"), { recursive: true });
    const newer = new Date(Date.now() + 120_000);
    writeFileSync(join(dir, "node_modules", "some-pkg", "index.js"), "export {};\n");
    utimesSync(join(dir, "node_modules", "some-pkg", "index.js"), newer, newer);

    expect(await isWorkspaceDistStale(dir, "dist/index.mjs")).toBe(false);
  });
});

function makeMember(dir: string, name: string, localDeps: string[] = []): WorkspaceMember {
  return { name, dir, localDeps };
}

describe("contentHashStalenessOracle", () => {
  it("is stale with no cache and no dist", async () => {
    const dir = makePackageDir();
    const oracle = contentHashStalenessOracle(mkTmp(join(tmpdir(), "bos-hash-root-")), [
      makeMember(dir, "a"),
    ]);

    expect(await oracle.isStale(makeMember(dir, "a"))).toBe(true);
  });

  it("is stale when the dist entry is missing even with a recorded hash", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const oracle = contentHashStalenessOracle(root, [makeMember(dir, "a")]);
    await oracle.recordBuilt?.(makeMember(dir, "a"));

    rmSync(join(dir, "dist", "index.mjs"));
    expect(await oracle.isStale(makeMember(dir, "a"))).toBe(true);
  });

  it("is stale when a file moves between directories (path-aware hash)", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    mkdirSync(join(dir, "src", "moved"), { recursive: true });
    writeFileSync(join(dir, "src", "moved", "index.ts"), "export {};\n");
    rmSync(join(dir, "src", "index.ts"));
    expect(await oracle.isStale(member)).toBe(true);
  });

  it("is fresh after recordBuilt when nothing changed", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    expect(await oracle.isStale(member)).toBe(false);
  });

  it("is stale when a source file's content changes", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    writeFileSync(join(dir, "src", "index.ts"), "export const changed = true;\n");
    expect(await oracle.isStale(member)).toBe(true);
  });

  it("is fresh when a file changes but content is identical (touch)", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, "src", "index.ts"), future, future);
    expect(await oracle.isStale(member)).toBe(false);
  });

  it("is stale when a local dependency's source changes (transitive hash)", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const aDir = makePackageDir();
    const bDir = makePackageDir();
    const dep = makeMember(aDir, "dep");
    const app = makeMember(bDir, "app", ["dep"]);
    const oracle = contentHashStalenessOracle(root, [dep, app]);
    await oracle.recordBuilt?.(app);

    writeFileSync(join(aDir, "src", "index.ts"), "export const dep = 2;\n");
    expect(await oracle.isStale(app)).toBe(true);
    expect(await oracle.isStale(dep)).toBe(true);
  });

  it("persists the cache across oracle instances (new process run)", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");

    await contentHashStalenessOracle(root, [member]).recordBuilt?.(member);
    const second = contentHashStalenessOracle(root, [member]);
    expect(await second.isStale(member)).toBe(false);
  });
});
