import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IMPORT_REPORT_PATH, importWorkspace } from "../../src/cli/import";
import type { ImportOptions } from "../../src/contract";

const WS = "plugins/demo";
const M = `${WS}/src/db/migrations`;

const writeTree = (root: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const contractSource = (routes: string[]): string =>
  `import { z } from "zod";
export const contract = {
  health: oc.route({ method: "GET", path: "/health" }).output(z.string()),
${routes.join("\n")}
};
`;

const journalEntry = (idx: number, tag: string, when: number) => ({
  idx,
  version: "7",
  when,
  tag,
  breakpoints: true,
});

const sql = (table: string) => `CREATE TABLE ${table} (id int);\n`;

const journalFor = (tags: Array<[number, string]>): string =>
  json({
    version: "7",
    dialect: "postgresql",
    entries: tags.map(([idx, tag]) => journalEntry(idx, tag, 1_700_000_000_000 + idx)),
  });

const snapshotFile = (id: string): string => json({ version: "7", dialect: "postgresql", id });

const upstreamContractRoot = `import { oc } from "@orpc/contract";
import { upstreamRoutes } from "./contract/upstream.contract";
export const contract = oc.router({
  ...upstreamRoutes,
});
`;

const upstreamContractSplit = `import { z } from "zod";
import { oc } from "@orpc/contract";
export const upstreamRoutes = {
  health: oc.route({ method: "GET", path: "/health" }).output(z.string()),
  create: oc.route({ method: "PUT", path: "/v1/demo/upstream" }).output(z.void()),
};
`;

function makeUpstream(): string {
  const root = mkdtempSync(join(tmpdir(), "import-upstream-"));
  writeTree(root, {
    [`${WS}/package.json`]: json({
      name: "@test/demo",
      version: "2.0.0",
      dependencies: { "left-pad": "^2.0.0", "right-pad": "^1.0.0" },
    }),
    [`${WS}/src/index.ts`]: "export const x = 2;\n",
    [`${WS}/src/shared.ts`]: "export const shared = true;\n",
    [`${WS}/src/upstream-only.ts`]: "export const upstreamOnly = true;\n",
    [`${WS}/src/contract.ts`]: upstreamContractRoot,
    [`${WS}/src/contract/upstream.contract.ts`]: upstreamContractSplit,
    [`${M}/meta/_journal.json`]: journalFor([
      [0, "0000_base"],
      [1, "0001_shared_one"],
      [2, "0002_shared_two"],
      [3, "0003_upstream-new"],
      [4, "0004_upstream-more"],
      [5, "0005_upstream-tail"],
    ]),
    [`${M}/0000_base.sql`]: sql("base"),
    [`${M}/0001_shared_one.sql`]: sql("shared_one"),
    [`${M}/0002_shared_two.sql`]: sql("shared_two"),
    [`${M}/0003_upstream-new.sql`]: sql("upstream_new"),
    [`${M}/0004_upstream-more.sql`]: sql("upstream_more"),
    [`${M}/0005_upstream-tail.sql`]: sql("upstream_tail"),
    [`${M}/meta/0000_snapshot.json`]: snapshotFile("shared-0"),
    [`${M}/meta/0001_snapshot.json`]: snapshotFile("shared-1"),
    [`${M}/meta/0002_snapshot.json`]: snapshotFile("shared-2"),
    [`${M}/meta/0003_snapshot.json`]: snapshotFile("upstream-3"),
    [`${M}/meta/0004_snapshot.json`]: snapshotFile("upstream-4"),
    [`${M}/meta/0005_snapshot.json`]: snapshotFile("upstream-5"),
  });
  return root;
}

function makeChild(): string {
  const root = mkdtempSync(join(tmpdir(), "import-child-"));
  writeTree(root, {
    [`${WS}/package.json`]: json({
      name: "@test/demo",
      version: "1.0.0",
      dependencies: { "left-pad": "^1.0.0", "only-local": "^1.0.0" },
    }),
    [`${WS}/src/index.ts`]: "export const x = 1;\n",
    [`${WS}/src/shared.ts`]: "export const shared = true;\n",
    [`${WS}/src/local-only.ts`]: "export const localOnly = true;\n",
    [`${WS}/src/contract.ts`]: contractSource([
      '  local: oc.route({ method: "POST", path: "/v1/demo/local" }).output(z.void()),',
    ]),
    [`${M}/meta/_journal.json`]: journalFor([
      [0, "0000_base"],
      [1, "0001_shared_one"],
      [2, "0002_shared_two"],
      [3, "0003_local-custom"],
      [4, "0004_local-extra"],
    ]),
    [`${M}/0000_base.sql`]: sql("base"),
    [`${M}/0001_shared_one.sql`]: sql("shared_one"),
    [`${M}/0002_shared_two.sql`]: sql("shared_two"),
    [`${M}/0003_local-custom.sql`]: sql("local_custom"),
    [`${M}/0004_local-extra.sql`]: sql("local_extra"),
    [`${M}/meta/0000_snapshot.json`]: snapshotFile("shared-0"),
    [`${M}/meta/0001_snapshot.json`]: snapshotFile("shared-1"),
    [`${M}/meta/0002_snapshot.json`]: snapshotFile("shared-2"),
    [`${M}/meta/0003_snapshot.json`]: snapshotFile("local-3"),
    [`${M}/meta/0004_snapshot.json`]: snapshotFile("local-4"),
  });
  return root;
}

describe("bos import — migration-chain reconciliation", () => {
  let upstream: string;
  let child: string;

  beforeAll(() => {
    upstream = makeUpstream();
    child = makeChild();
  });

  afterAll(() => {
    rmSync(upstream, { recursive: true, force: true });
    rmSync(child, { recursive: true, force: true });
  });

  const options = (overrides: Partial<ImportOptions> = {}): ImportOptions => ({
    workspace: `./${WS}/`,
    from: upstream,
    yes: false,
    dryRun: false,
    noInstall: true,
    json: false,
    ...overrides,
  });

  const readChild = (rel: string): string => readFileSync(join(child, rel), "utf-8");
  const childExists = (rel: string): boolean => existsSync(join(child, rel));

  it("dry-run reports kept/appended/renumbered sets and writes nothing", async () => {
    const result = await importWorkspace(child, options({ dryRun: true }));

    expect(result.status).toBe("dry-run");
    expect(result.conflicts).toEqual([`${WS}/src/contract.ts`, `${WS}/src/index.ts`]);
    expect(result.added).toEqual([
      `${WS}/src/contract/upstream.contract.ts`,
      `${WS}/src/upstream-only.ts`,
    ]);
    expect(result.preservedLocal).toEqual([
      `${M}/0003_local-custom.sql`,
      `${M}/0004_local-extra.sql`,
      `${WS}/src/local-only.ts`,
    ]);
    expect(result.unchanged).toEqual([
      `${M}/0000_base.sql`,
      `${M}/0001_shared_one.sql`,
      `${M}/0002_shared_two.sql`,
      `${M}/meta/0000_snapshot.json`,
      `${M}/meta/0001_snapshot.json`,
      `${M}/meta/0002_snapshot.json`,
      `${WS}/src/shared.ts`,
    ]);
    expect(result.heldBackMigrations).toEqual([]);
    expect(result.migrationCollisions).toEqual([]);
    expect(result.migrationReconciliation).toEqual({
      kept: [
        "0000_base",
        "0001_shared_one",
        "0002_shared_two",
        "0003_local-custom",
        "0004_local-extra",
      ],
      appended: [
        { idx: 5, fromTag: "0003_upstream-new", toTag: "0005_upstream-new" },
        { idx: 6, fromTag: "0004_upstream-more", toTag: "0006_upstream-more" },
        { idx: 7, fromTag: "0005_upstream-tail", toTag: "0007_upstream-tail" },
      ],
      contentMatched: [],
      unresolvable: [],
    });

    expect(childExists(`${WS}/src/upstream-only.ts`)).toBe(false);
    expect(readChild(`${WS}/src/index.ts`)).toContain("x = 1");
    expect(readChild(`${M}/meta/_journal.json`)).toContain("0003_local-custom");

    const report = readChild(IMPORT_REPORT_PATH);
    expect(report).toContain("Dry run — no files written");
    expect(report).toContain("## Migration chain reconciliation");
    expect(report).toContain("`0003_upstream-new` | `0005_upstream-new` | 5");
    expect(report).toContain("Next boot will apply the 3 appended migration(s)");
    expect(report).toContain("Snapshot-chain note");
  });

  it("refuses without --yes while conflicts or appended migrations exist", async () => {
    const result = await importWorkspace(child, options());

    expect(result.status).toBe("conflicts");
    expect(childExists(`${WS}/src/upstream-only.ts`)).toBe(false);
    expect(readChild(`${M}/meta/_journal.json`)).toContain("0003_local-custom");
    expect(readChild(IMPORT_REPORT_PATH)).toContain(
      "Refused — unresolvable conflicts exist, nothing was written",
    );
  });

  it("confirms through deps.confirm with the appended count", async () => {
    const seen: Array<{ conflictCount: number; appendedCount: number; heldCount: number }> = [];
    const refused = await importWorkspace(child, options(), {
      confirm: async (info) => {
        seen.push({
          conflictCount: info.conflictCount,
          appendedCount: info.appendedCount,
          heldCount: info.heldCount,
        });
        return false;
      },
    });
    expect(refused.status).toBe("conflicts");
    expect(seen).toEqual([{ conflictCount: 2, appendedCount: 3, heldCount: 0 }]);

    const approved = await importWorkspace(child, options(), { confirm: async () => true });
    expect(approved.status).toBe("imported");
    expect(childExists(`${WS}/src/upstream-only.ts`)).toBe(true);
  });

  it("applies with --yes: renumbered files, rebuilt journal, preserved applied entries", async () => {
    rmSync(child, { recursive: true, force: true });
    child = makeChild();

    const result = await importWorkspace(child, options({ yes: true }));

    expect(result.status).toBe("imported");

    expect(childExists(`${M}/0003_upstream-new.sql`)).toBe(false);
    expect(childExists(`${M}/0005_upstream-new.sql`)).toBe(true);
    expect(childExists(`${M}/0006_upstream-more.sql`)).toBe(true);
    expect(childExists(`${M}/0007_upstream-tail.sql`)).toBe(true);
    expect(readChild(`${M}/0005_upstream-new.sql`)).toBe(sql("upstream_new"));
    expect(childExists(`${M}/meta/0005_snapshot.json`)).toBe(true);
    expect(readChild(`${M}/meta/0005_snapshot.json`)).toContain("upstream-3");
    expect(childExists(`${M}/meta/0007_snapshot.json`)).toBe(true);
    expect(readChild(`${M}/meta/0007_snapshot.json`)).toContain("upstream-5");

    expect(readChild(`${M}/0003_local-custom.sql`)).toBe(sql("local_custom"));
    expect(readChild(`${M}/meta/0003_snapshot.json`)).toContain("local-3");

    const rebuilt = JSON.parse(readChild(`${M}/meta/_journal.json`)) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string; when: number; breakpoints: boolean }>;
    };
    expect(rebuilt.version).toBe("7");
    expect(rebuilt.dialect).toBe("postgresql");
    expect(rebuilt.entries).toEqual([
      journalEntry(0, "0000_base", 1_700_000_000_000),
      journalEntry(1, "0001_shared_one", 1_700_000_000_001),
      journalEntry(2, "0002_shared_two", 1_700_000_000_002),
      journalEntry(3, "0003_local-custom", 1_700_000_000_003),
      journalEntry(4, "0004_local-extra", 1_700_000_000_004),
      journalEntry(5, "0005_upstream-new", 1_700_000_000_005),
      journalEntry(6, "0006_upstream-more", 1_700_000_000_006),
      journalEntry(7, "0007_upstream-tail", 1_700_000_000_007),
    ]);

    expect(result.backupDir).toBeTypeOf("string");
    const backupJournal = readFileSync(
      join(result.backupDir as string, `${M}/meta/_journal.json`),
      "utf-8",
    );
    expect(backupJournal).toContain("0003_local-custom");
    expect(JSON.parse(backupJournal)).toEqual({
      version: "7",
      dialect: "postgresql",
      entries: [
        journalEntry(0, "0000_base", 1_700_000_000_000),
        journalEntry(1, "0001_shared_one", 1_700_000_000_001),
        journalEntry(2, "0002_shared_two", 1_700_000_000_002),
        journalEntry(3, "0003_local-custom", 1_700_000_000_003),
        journalEntry(4, "0004_local-extra", 1_700_000_000_004),
      ],
    });

    const pkg = JSON.parse(readChild(`${WS}/package.json`)) as {
      version: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.dependencies["left-pad"]).toBe("^2.0.0");
    expect(pkg.dependencies["only-local"]).toBe("^1.0.0");

    const snapshot = JSON.parse(readChild(".bos/import-snapshot.json")) as {
      workspaces: Record<string, { files: Record<string, string> }>;
    };
    const files = snapshot.workspaces[WS]?.files ?? {};
    expect(files[`${M}/meta/_journal.json`]).toBeTypeOf("string");
    expect(files[`${M}/0005_upstream-new.sql`]).toBeTypeOf("string");
    expect(files[`${M}/0007_upstream-tail.sql`]).toBeTypeOf("string");
    expect(files[`${M}/0003_upstream-new.sql`]).toBeUndefined();
    expect(files[`${M}/0005_upstream-tail.sql`]).toBeUndefined();

    const report = readChild(IMPORT_REPORT_PATH);
    expect(report).toContain("Applied — upstream written over shared files");
    expect(report).toContain("## Migration chain reconciliation");
  });

  it("converges fully on a second run — appended migrations match by content", async () => {
    const result = await importWorkspace(child, options({ dryRun: true }));

    expect(result.status).toBe("dry-run");
    expect(result.conflicts).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.heldBackMigrations).toEqual([]);
    expect(result.migrationCollisions).toEqual([]);
    expect(result.migrationReconciliation).toEqual({
      kept: [
        "0000_base",
        "0001_shared_one",
        "0002_shared_two",
        "0003_local-custom",
        "0004_local-extra",
        "0005_upstream-new",
        "0006_upstream-more",
        "0007_upstream-tail",
      ],
      appended: [],
      contentMatched: ["0003_upstream-new", "0004_upstream-more", "0005_upstream-tail"],
      unresolvable: [],
    });
    expect(childExists(`${M}/0003_upstream-new.sql`)).toBe(false);
    expect(readChild(`${M}/meta/_journal.json`)).toContain("0007_upstream-tail");
  });

  it("holds the chain when a shared migration hashes differently", async () => {
    rmSync(child, { recursive: true, force: true });
    child = makeChild();
    const drifted = makeUpstream();
    writeTree(drifted, { [`${M}/0001_shared_one.sql`]: sql("shared_one_drifted") });

    const result = await importWorkspace(child, options({ from: drifted, dryRun: true }));

    expect(result.migrationCollisions).toEqual([
      {
        kind: "tag-mismatch",
        idx: 1,
        localTag: "0001_shared_one",
        upstreamTag: "0001_shared_one",
        message:
          "0001_shared_one has different content locally than upstream — already-applied hashes would drift",
      },
    ]);
    expect(result.heldBackMigrations).toEqual([
      `${M}/0001_shared_one.sql`,
      `${M}/0003_upstream-new.sql`,
      `${M}/0004_upstream-more.sql`,
      `${M}/0005_upstream-tail.sql`,
      `${M}/meta/0003_snapshot.json`,
      `${M}/meta/0004_snapshot.json`,
      `${M}/meta/0005_snapshot.json`,
      `${M}/meta/_journal.json`,
    ]);
    expect(result.migrationReconciliation?.appended).toEqual([
      { idx: 5, fromTag: "0003_upstream-new", toTag: "0005_upstream-new" },
      { idx: 6, fromTag: "0004_upstream-more", toTag: "0006_upstream-more" },
      { idx: 7, fromTag: "0005_upstream-tail", toTag: "0007_upstream-tail" },
    ]);

    const report = readChild(IMPORT_REPORT_PATH);
    expect(report).toContain("## Migration chain held back");
    expect(report).toContain("reconciliation could not produce a safe merged chain");

    const applied = await importWorkspace(child, options({ from: drifted, yes: true }));
    expect(applied.status).toBe("imported");
    expect(readChild(`${M}/0001_shared_one.sql`)).toBe(sql("shared_one"));
    expect(readChild(`${M}/meta/_journal.json`)).toContain("0003_local-custom");
    expect(childExists(`${M}/0005_upstream-new.sql`)).toBe(false);
  });

  it("errors loudly when the workspace is missing from the source", async () => {
    const result = await importWorkspace(child, options({ workspace: "plugins/absent" }));
    expect(result.status).toBe("error");
    expect(result.error).toContain("not found");
  });
});
