import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectMigrationCollisions, loadMigrationEntries } from "../../src/cli/import";

const WS = "plugins/demo";

describe("bos import — loadMigrationEntries", () => {
  let root: string;

  const writeChainFile = (projectRoot: string, rel: string, content: string) => {
    const full = join(projectRoot, WS, "src", "db", "migrations", rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "import-migrations-"));
    writeChainFile(
      root,
      "meta/_journal.json",
      JSON.stringify({
        version: 7,
        dialect: "postgresql",
        entries: [
          { idx: 0, tag: "0000_base", version: "7" },
          { idx: 1, tag: "0001_local_extra", version: "7" },
        ],
      }),
    );
    writeChainFile(root, "0000_base.sql", "CREATE TABLE base (id int);\n");
    writeChainFile(root, "0001_local_extra.sql", "CREATE TABLE local_extra (id int);\n");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loads journal entries sorted by idx with sql content hashes", () => {
    const entries = loadMigrationEntries(root, WS);
    expect(entries).not.toBeNull();
    expect(entries?.map((entry) => [entry.idx, entry.tag])).toEqual([
      [0, "0000_base"],
      [1, "0001_local_extra"],
    ]);
    expect(entries?.[0].sha).toBeTypeOf("string");
    expect(entries?.[1].sha).toBeTypeOf("string");
  });

  it("returns null when the journal is missing", () => {
    expect(loadMigrationEntries(root, "plugins/absent")).toBeNull();
  });

  it("returns null when the journal is unreadable", () => {
    const bad = mkdtempSync(join(tmpdir(), "import-migrations-bad-"));
    writeChainFile(bad, "meta/_journal.json", "{ not json");
    try {
      expect(loadMigrationEntries(bad, WS)).toBeNull();
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });
});

describe("bos import — detectMigrationCollisions", () => {
  const local = [
    { idx: 0, tag: "0000_base", sha: "aaa" },
    { idx: 1, tag: "0001_local_extra", sha: "bbb" },
    { idx: 2, tag: "0002_more", sha: "ccc" },
  ];

  it("flags idx reuse when the same idx carries a different tag", () => {
    const collisions = detectMigrationCollisions(local, [
      { idx: 1, tag: "0001_upstream_diff", sha: "zzz" },
    ]);
    expect(collisions).toEqual([
      {
        kind: "idx-reuse",
        idx: 1,
        localTag: "0001_local_extra",
        upstreamTag: "0001_upstream_diff",
        message: "idx 1 is 0001_local_extra locally but 0001_upstream_diff upstream",
      },
    ]);
  });

  it("flags content drift when an identical tag+idx hashes differently", () => {
    const collisions = detectMigrationCollisions(
      [{ idx: 0, tag: "0000_base", sha: "aaa" }],
      [{ idx: 0, tag: "0000_base", sha: "different" }],
    );
    expect(collisions.map((collision) => collision.kind)).toEqual(["tag-mismatch"]);
  });

  it("skips the content check when a side has no hash", () => {
    const collisions = detectMigrationCollisions(
      [{ idx: 0, tag: "0000_base", sha: null }],
      [{ idx: 0, tag: "0000_base", sha: "different" }],
    );
    expect(collisions).toEqual([]);
  });

  it("accepts matching shared entries and appended upstream entries", () => {
    const collisions = detectMigrationCollisions(
      [{ idx: 0, tag: "0000_base", sha: "aaa" }],
      [
        { idx: 0, tag: "0000_base", sha: "aaa" },
        { idx: 1, tag: "0001_upstream", sha: "ddd" },
      ],
    );
    expect(collisions).toEqual([]);
  });

  it("flags an upstream entry landing below the local chain tail", () => {
    const gapped = [
      { idx: 0, tag: "0000_base", sha: "a" },
      { idx: 2, tag: "0002_tail", sha: "c" },
    ];
    const collisions = detectMigrationCollisions(gapped, [{ idx: 1, tag: "0001_new", sha: "b" }]);
    expect(collisions.map((collision) => collision.kind)).toEqual(["out-of-order"]);
    expect(collisions[0].message).toContain("below the local chain tail");
  });
});
