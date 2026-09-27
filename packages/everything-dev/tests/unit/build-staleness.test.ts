import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isWorkspaceDistStale } from "../../src/build";

const tmpDirs: string[] = [];

function makePackageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dist-staleness-"));
  tmpDirs.push(dir);
  mkdirSync(join(dir, "src", "nested"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}\n");
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
