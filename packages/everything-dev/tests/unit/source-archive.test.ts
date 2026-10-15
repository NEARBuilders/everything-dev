import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { list as tarList } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { computeSriHash } from "../../src/integrity";
import { buildSourceArchive } from "../../src/source-archive";

const tmpRoots: string[] = [];

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "bos-source-archive-test-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0).reverse()) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function tarEntryPaths(file: string): Promise<string[]> {
  const paths: string[] = [];
  await tarList({ file, onReadEntry: (entry) => paths.push(entry.path) });
  return paths.sort();
}

function seedWorkspace(root: string, content = "export const a = 1;\n"): string {
  const workspace = "ws-a";
  mkdirSync(join(root, workspace, "src"), { recursive: true });
  writeFileSync(join(root, workspace, "src", "a.ts"), content);
  writeFileSync(join(root, workspace, "package.json"), '{"name":"ws-a"}\n');
  mkdirSync(join(root, workspace, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, workspace, "node_modules", "dep", "index.js"), "x");
  mkdirSync(join(root, workspace, "dist"), { recursive: true });
  writeFileSync(join(root, workspace, "dist", "y.js"), "y");
  mkdirSync(join(root, workspace, ".bos"), { recursive: true });
  writeFileSync(join(root, workspace, ".bos", "state.json"), "{}\n");
  return workspace;
}

describe("buildSourceArchive", () => {
  it("archives the workspace subtree with repo-relative paths and skips the ignore set", async () => {
    const repoRoot = makeTmp();
    const outDir = makeTmp();
    const workspace = seedWorkspace(repoRoot);

    const archive = await buildSourceArchive({ repoRoot, workspace, outDir });

    expect(archive.file).toMatch(/^source\/source\.[0-9a-f]{16}\.tar\.gz$/);
    const paths = await tarEntryPaths(archive.path);
    expect(paths).toContain(`${workspace}/src/a.ts`);
    expect(paths).toContain(`${workspace}/package.json`);
    expect(paths.some((path) => path.includes("node_modules"))).toBe(false);
    expect(paths.some((path) => path.includes("dist/"))).toBe(false);
    expect(paths.some((path) => path.includes(".bos/"))).toBe(false);
  });

  it("names the archive by the sha256 of its bytes and reports the local SRI", async () => {
    const repoRoot = makeTmp();
    const outDir = makeTmp();
    const workspace = seedWorkspace(repoRoot);

    const archive = await buildSourceArchive({ repoRoot, workspace, outDir });

    const bytes = readFileSync(archive.path);
    const expectedName = `source.${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.tar.gz`;
    expect(archive.file).toBe(`source/${expectedName}`);
    expect(archive.integrity).toBe(computeSriHash(bytes));
    expect(archive.integrity).toMatch(/^sha384-/);
  });

  it("is content-stable: identical content yields the same archive name", async () => {
    const repoRoot = makeTmp();
    const workspace = seedWorkspace(repoRoot);

    const first = await buildSourceArchive({ repoRoot, workspace, outDir: makeTmp() });
    const second = await buildSourceArchive({ repoRoot, workspace, outDir: makeTmp() });

    expect(second.file).toBe(first.file);
  });

  it("yields a different archive name when content changes", async () => {
    const repoRoot = makeTmp();
    const workspace = seedWorkspace(repoRoot);
    const first = await buildSourceArchive({ repoRoot, workspace, outDir: makeTmp() });

    writeFileSync(join(repoRoot, workspace, "src", "a.ts"), "export const a = 2;\n");
    const second = await buildSourceArchive({ repoRoot, workspace, outDir: makeTmp() });

    expect(second.file).not.toBe(first.file);
  });

  it("cleanup removes the outDir", async () => {
    const repoRoot = makeTmp();
    const outDir = makeTmp();
    const workspace = seedWorkspace(repoRoot);

    const archive = await buildSourceArchive({ repoRoot, workspace, outDir });
    expect(existsSync(outDir)).toBe(true);

    archive.cleanup();

    expect(existsSync(outDir)).toBe(false);
  });
});
