import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrationEntries, reconcileMigrationChains } from "../../src/cli/import";

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

describe("bos import — reconcileMigrationChains", () => {
  const entry = (idx: number, tag: string, sha: string | null) => ({ idx, tag, sha });

  it("renumbers colliding upstream migrations after the local tail (issue #393 scenario)", () => {
    const shared = Array.from({ length: 11 }, (_, idx) =>
      entry(idx, `000${idx}_shared`, `s${idx}`),
    );
    const local = [
      ...shared,
      entry(11, "0011_default-community-teams", "l11"),
      entry(12, "0012_onboarding-redemption-new-member", "l12"),
    ];
    const upstream = [
      ...shared,
      entry(11, "0011_team-member-role", "u11"),
      entry(12, "0012_gifted_nicolaos", "u12"),
      entry(13, "0013_sleepy_komodo", "u13"),
    ];

    const plan = reconcileMigrationChains(local, upstream);

    expect(plan.kept).toEqual(local.map((item) => item.tag));
    expect(plan.unresolvable).toEqual([]);
    expect(plan.appended).toEqual([
      { idx: 13, fromTag: "0011_team-member-role", toTag: "0013_team-member-role" },
      { idx: 14, fromTag: "0012_gifted_nicolaos", toTag: "0014_gifted_nicolaos" },
      { idx: 15, fromTag: "0013_sleepy_komodo", toTag: "0015_sleepy_komodo" },
    ]);
  });

  it("treats identical chains as a no-op", () => {
    const chain = [entry(0, "0000_base", "a"), entry(1, "0001_tail", "b")];
    const plan = reconcileMigrationChains(chain, chain);
    expect(plan.kept).toEqual(["0000_base", "0001_tail"]);
    expect(plan.appended).toEqual([]);
    expect(plan.unresolvable).toEqual([]);
  });

  it("keeps local-only entries without appending anything when upstream adds nothing new", () => {
    const plan = reconcileMigrationChains(
      [entry(0, "0000_base", "a"), entry(1, "0001_local_extra", "b")],
      [entry(0, "0000_base", "a")],
    );
    expect(plan.kept).toEqual(["0000_base", "0001_local_extra"]);
    expect(plan.appended).toEqual([]);
    expect(plan.unresolvable).toEqual([]);
  });

  it("keeps an upstream tag that moved to a different idx when content is identical", () => {
    const plan = reconcileMigrationChains(
      [entry(0, "0000_base", "a"), entry(1, "0001_extra", "b")],
      [entry(0, "0000_base", "a"), entry(3, "0001_extra", "b"), entry(4, "0004_new", "c")],
    );
    expect(plan.appended).toEqual([{ idx: 2, fromTag: "0004_new", toTag: "0002_new" }]);
    expect(plan.unresolvable).toEqual([]);
  });

  it("matches previously renumbered migrations by content hash on repeat imports", () => {
    const plan = reconcileMigrationChains(
      [
        entry(0, "0000_base", "a"),
        entry(1, "0013_team-member-role", "u11"),
        entry(2, "0014_gifted_nicolaos", "u12"),
      ],
      [
        entry(0, "0000_base", "a"),
        entry(1, "0011_team-member-role", "u11"),
        entry(2, "0012_gifted_nicolaos", "u12"),
      ],
    );
    expect(plan.appended).toEqual([]);
    expect(plan.unresolvable).toEqual([]);
    expect(plan.kept).toEqual(["0000_base", "0013_team-member-role", "0014_gifted_nicolaos"]);
  });

  it("flags content drift on a shared tag as unresolvable", () => {
    const plan = reconcileMigrationChains(
      [entry(0, "0000_base", "a"), entry(1, "0001_same", "local-hash")],
      [
        entry(0, "0000_base", "a"),
        entry(1, "0001_same", "upstream-hash"),
        entry(2, "0002_new", "c"),
      ],
    );
    expect(plan.unresolvable).toEqual([
      {
        kind: "tag-mismatch",
        idx: 1,
        localTag: "0001_same",
        upstreamTag: "0001_same",
        message:
          "0001_same has different content locally than upstream — already-applied hashes would drift",
      },
    ]);
    expect(plan.appended).toEqual([{ idx: 2, fromTag: "0002_new", toTag: "0002_new" }]);
  });

  it("flags content drift even when the shared tag sits at a different idx", () => {
    const plan = reconcileMigrationChains(
      [entry(0, "0000_base", "a"), entry(1, "0001_same", "local-hash")],
      [entry(0, "0000_base", "a"), entry(5, "0001_same", "upstream-hash")],
    );
    expect(plan.unresolvable).toHaveLength(1);
    expect(plan.unresolvable[0].kind).toBe("tag-mismatch");
    expect(plan.appended).toEqual([]);
  });

  it("skips content comparison when a side has no hash", () => {
    const plan = reconcileMigrationChains(
      [entry(0, "0000_base", "a"), { idx: 1, tag: "0001_same", sha: null }],
      [entry(0, "0000_base", "a"), entry(1, "0001_same", "upstream-hash")],
    );
    expect(plan.unresolvable).toEqual([]);
    expect(plan.appended).toEqual([]);
  });

  it("keeps tags without a numeric prefix unchanged when appended", () => {
    const plan = reconcileMigrationChains(
      [entry(0, "0000_base", "a")],
      [entry(0, "0000_base", "a"), entry(1, "weird_migration", "b")],
    );
    expect(plan.appended).toEqual([
      { idx: 1, fromTag: "weird_migration", toTag: "weird_migration" },
    ]);
  });

  it("handles an empty upstream chain", () => {
    const plan = reconcileMigrationChains([entry(0, "0000_base", "a")], []);
    expect(plan.kept).toEqual(["0000_base"]);
    expect(plan.appended).toEqual([]);
    expect(plan.unresolvable).toEqual([]);
  });
});
