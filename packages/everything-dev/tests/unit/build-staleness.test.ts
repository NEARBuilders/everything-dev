import {
  mkdirSync,
  mkdtempSync,
  mkdtempSync as mkTmp,
  readFileSync,
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
  judgeStaleness,
  mtimeStalenessOracle,
  type StalenessVerdict,
  type WorkspaceMember,
} from "../../src/services/workspace/workspace";

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

const STAMP = new Date(1_700_000_000_000);

function cacheEntry(root: string, name: string): Record<string, unknown> {
  const cache = JSON.parse(readFileSync(join(root, ".bos", "build-cache.json"), "utf8")) as {
    version: number;
    members: Record<string, Record<string, unknown>>;
  };
  return { version: cache.version, ...cache.members[name] };
}

async function judged(
  oracle: { judge?: (member: WorkspaceMember) => Promise<StalenessVerdict> },
  member: WorkspaceMember,
): Promise<StalenessVerdict> {
  const verdict = await oracle.judge?.(member);
  if (!verdict) throw new Error("oracle under test must implement judge");
  return verdict;
}

describe("#481 stats-manifest fast path", () => {
  it("reuses the recorded hash without content reads when stats match", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const entryPath = join(dir, "src", "index.ts");
    utimesSync(entryPath, STAMP, STAMP);
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    writeFileSync(entryPath, "export {a};");
    utimesSync(entryPath, STAMP, STAMP);

    expect(await oracle.isStale(member)).toBe(false);
  });

  it("is stale when a new file appears (manifest key drift)", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    writeFileSync(join(dir, "src", "added.ts"), "export {};\n");

    const verdict = await judged(oracle, member);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toBe("input-hash-mismatch");
  });

  it("is stale when a recorded file is deleted", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    rmSync(join(dir, "src", "nested", "deep.ts"));

    const verdict = await judged(oracle, member);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toBe("input-hash-mismatch");
  });

  it("falls back to a full rehash on stats drift and stays fresh on identical content", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, "src", "index.ts"), future, future);

    const verdict = await judged(oracle, member);
    expect(verdict).toEqual({ stale: false, reason: null, oracle: "content-hash" });
  });

  it("judges a pre-v2 cache stale without crashing (version gate)", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    mkdirSync(join(root, ".bos"), { recursive: true });
    writeFileSync(
      join(root, ".bos", "build-cache.json"),
      `${JSON.stringify({ a: { hash: "deadbeef" } })}\n`,
    );
    const oracle = contentHashStalenessOracle(root, [member]);

    expect(await oracle.isStale(member)).toBe(true);
    expect((await judged(oracle, member)).reason).toBe("no-cache-entry");
  });

  it("falls back to a full rehash when the recorded stats manifest is missing", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    const cachePath = join(root, ".bos", "build-cache.json");
    const cache = JSON.parse(readFileSync(cachePath, "utf8")) as {
      members: Record<string, Record<string, unknown>>;
    };
    delete cache.members.a.files;
    delete cache.members.a.selfHash;
    writeFileSync(cachePath, JSON.stringify(cache));

    expect(await oracle.isStale(member)).toBe(false);

    writeFileSync(join(dir, "src", "index.ts"), "export const changed = true;\n");
    expect(await oracle.isStale(member)).toBe(true);
  });

  it("persists the v2 cache shape with version, stats manifest, and dist record", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);

    await oracle.recordBuilt?.(member);

    const entry = cacheEntry(root, "a");
    expect(entry.version).toBe(2);
    expect(entry.selfHash).toBeTruthy();
    const files = entry.files as Record<string, [number, number]>;
    expect(files["src/index.ts"]).toHaveLength(2);
    expect(files["src/nested/deep.ts"]).toHaveLength(2);
    expect(files["dist/index.mjs"]).toBeUndefined();
    const dist = entry.dist as {
      entry: string;
      hash: string;
      anchorHash: string;
      files: Record<string, [number, number]>;
    };
    expect(dist.entry).toBe("dist/index.mjs");
    expect(dist.anchorHash).toBeTruthy();
    expect(dist.files["dist/index.mjs"]).toHaveLength(2);
  });
});

describe("#482 dist output integrity", () => {
  it("is stale with dist-hash-mismatch when the dist entry is truncated", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    writeFileSync(join(dir, "dist", "index.mjs"), "x");

    const verdict = await judged(oracle, member);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toBe("dist-hash-mismatch");
  });

  it("is stale when a dist sibling is deleted", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    writeFileSync(join(dir, "dist", "extra.mjs"), "export const extra = 1;\n");
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    rmSync(join(dir, "dist", "extra.mjs"));

    const verdict = await judged(oracle, member);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toBe("dist-hash-mismatch");
  });

  it("is fresh when a dist file is touched without a content change", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, "dist", "index.mjs"), future, future);

    expect(await oracle.isStale(member)).toBe(false);
  });

  it("is stale when the dist entry is corrupted with identical stats", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const entryPath = join(dir, "dist", "index.mjs");
    utimesSync(entryPath, STAMP, STAMP);
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    writeFileSync(entryPath, "export {q};");
    utimesSync(entryPath, STAMP, STAMP);

    const verdict = await judged(oracle, member);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toBe("dist-hash-mismatch");
  });

  it("keeps the stats fast path for dist siblings with identical stats", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const sibling = join(dir, "dist", "extra.mjs");
    writeFileSync(sibling, "export const extra = 1;\n");
    utimesSync(sibling, STAMP, STAMP);
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    writeFileSync(sibling, "export const extra = 2;\n");
    utimesSync(sibling, STAMP, STAMP);

    expect(await oracle.isStale(member)).toBe(false);
  });

  it("bounds the dist record to the dist tree for ./-prefixed export entries", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ exports: { ".": { import: "./dist/index.mjs" } } })}\n`,
    );
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);

    await oracle.recordBuilt?.(member);

    const dist = cacheEntry(root, "a").dist as {
      entry: string;
      files: Record<string, [number, number]>;
    };
    expect(dist.entry).toBe("./dist/index.mjs");
    expect(Object.keys(dist.files).every((key) => key.startsWith("dist/"))).toBe(true);
    expect(await oracle.isStale(member)).toBe(false);
  });
});

describe("#483 verdict and reason model", () => {
  it("reports no-cache-entry for a member the cache never recorded", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);

    const verdict = await judged(oracle, member);
    expect(verdict).toEqual({ stale: true, reason: "no-cache-entry", oracle: "content-hash" });
  });

  it("reports missing-dist when the dist entry file is gone", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    rmSync(join(dir, "dist", "index.mjs"));

    const verdict = await judged(oracle, member);
    expect(verdict).toEqual({ stale: true, reason: "missing-dist", oracle: "content-hash" });
  });

  it("reports input-hash-mismatch when a source file's content changes", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const dir = makePackageDir();
    const member = makeMember(dir, "a");
    const oracle = contentHashStalenessOracle(root, [member]);
    await oracle.recordBuilt?.(member);

    writeFileSync(join(dir, "src", "index.ts"), "export const changed = true;\n");

    const verdict = await judged(oracle, member);
    expect(verdict).toEqual({ stale: true, reason: "input-hash-mismatch", oracle: "content-hash" });
  });

  it("attributes a stale dependency by name", async () => {
    const root = mkTmp(join(tmpdir(), "bos-hash-root-"));
    const aDir = makePackageDir();
    const bDir = makePackageDir();
    const dep = makeMember(aDir, "dep");
    const app = makeMember(bDir, "app", ["dep"]);
    const oracle = contentHashStalenessOracle(root, [dep, app]);
    await oracle.recordBuilt?.(app);

    writeFileSync(join(aDir, "src", "index.ts"), "export const dep = 2;\n");

    const verdict = await judged(oracle, app);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toBe("dependency-stale:dep");
  });

  it("reports fresh verdicts with null reason through the mtime oracle", async () => {
    const dir = makePackageDir();
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, "dist", "index.mjs"), future, future);

    const verdict = await judged(mtimeStalenessOracle, makeMember(dir, "a"));
    expect(verdict).toEqual({ stale: false, reason: null, oracle: "mtime" });
  });

  it("reports missing-dist through the mtime oracle", async () => {
    const dir = makePackageDir();
    rmSync(join(dir, "dist", "index.mjs"));

    const verdict = await judged(mtimeStalenessOracle, makeMember(dir, "a"));
    expect(verdict).toEqual({ stale: true, reason: "missing-dist", oracle: "mtime" });
  });

  it("reports input drift as input-hash-mismatch through the mtime oracle", async () => {
    const dir = makePackageDir();
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, "dist", "index.mjs"), future, future);
    const newer = new Date(Date.now() + 120_000);
    utimesSync(join(dir, "src", "index.ts"), newer, newer);

    const verdict = await judged(mtimeStalenessOracle, makeMember(dir, "a"));
    expect(verdict).toEqual({ stale: true, reason: "input-hash-mismatch", oracle: "mtime" });
  });

  it("falls back to the boolean path with best-effort fields for oracles without a judge", async () => {
    const dir = makePackageDir();

    const verdict = await judgeStaleness({ isStale: async () => true }, makeMember(dir, "a"));

    expect(verdict).toEqual({ stale: true, reason: "input-hash-mismatch", oracle: "mtime" });
  });
});
