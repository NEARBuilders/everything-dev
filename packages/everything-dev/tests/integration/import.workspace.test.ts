import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IMPORT_REPORT_PATH, importWorkspace } from "../../src/cli/import";
import type { ImportOptions } from "../../src/contract";

const WS = "plugins/demo";

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

const journal = (entries: Array<{ idx: number; tag: string }>) =>
  json({
    version: 7,
    dialect: "postgresql",
    entries: entries.map((entry) => ({ ...entry, version: "7" })),
  });

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
    [`${WS}/src/db/migrations/meta/_journal.json`]: journal([
      { idx: 0, tag: "0000_base" },
      { idx: 1, tag: "0001_upstream_diff" },
    ]),
    [`${WS}/src/db/migrations/0000_base.sql`]: "CREATE TABLE base (id int);\n",
    [`${WS}/src/db/migrations/0001_upstream_diff.sql`]: "CREATE TABLE upstream_diff (id int);\n",
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
    [`${WS}/src/db/migrations/meta/_journal.json`]: journal([
      { idx: 0, tag: "0000_base" },
      { idx: 1, tag: "0001_local_extra" },
    ]),
    [`${WS}/src/db/migrations/0000_base.sql`]: "CREATE TABLE base (id int);\n",
    [`${WS}/src/db/migrations/0001_local_extra.sql`]: "CREATE TABLE local_extra (id int);\n",
  });
  return root;
}

describe("bos import — workspace import from a local source", () => {
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

  it("dry-run classifies every bucket, reports deltas, and writes nothing", async () => {
    const result = await importWorkspace(child, options({ dryRun: true }));

    expect(result.status).toBe("dry-run");
    expect(result.workspace).toBe(WS);
    expect(result.ref).toBe("local");
    expect(result.conflicts).toEqual([
      `${WS}/src/contract.ts`,
      `${WS}/src/db/migrations/meta/_journal.json`,
      `${WS}/src/index.ts`,
    ]);
    expect(result.added).toEqual([
      `${WS}/src/contract/upstream.contract.ts`,
      `${WS}/src/db/migrations/0001_upstream_diff.sql`,
      `${WS}/src/upstream-only.ts`,
    ]);
    expect(result.preservedLocal).toEqual([
      `${WS}/src/db/migrations/0001_local_extra.sql`,
      `${WS}/src/local-only.ts`,
    ]);
    expect(result.unchanged).toEqual([
      `${WS}/src/db/migrations/0000_base.sql`,
      `${WS}/src/shared.ts`,
    ]);
    expect(result.merged).toEqual([`${WS}/package.json`]);
    expect(result.heldBackMigrations).toEqual([
      `${WS}/src/db/migrations/0001_upstream_diff.sql`,
      `${WS}/src/db/migrations/meta/_journal.json`,
    ]);
    expect(result.migrationCollisions).toEqual([
      {
        kind: "idx-reuse",
        idx: 1,
        localTag: "0001_local_extra",
        upstreamTag: "0001_upstream_diff",
        message: "idx 1 is 0001_local_extra locally but 0001_upstream_diff upstream",
      },
    ]);
    expect(result.routeDelta).toEqual({
      oursOnly: ["POST /v1/demo/local"],
      theirsOnly: ["PUT /v1/demo/upstream"],
    });

    expect(childExists(`${WS}/src/upstream-only.ts`)).toBe(false);
    expect(readChild(`${WS}/src/index.ts`)).toContain("x = 1");

    const report = readChild(IMPORT_REPORT_PATH);
    expect(report).toContain("Dry run — no files written");
    expect(report).toContain("Migration chain held back");
    expect(report).toContain("idx-reuse");
    expect(report).toContain("POST /v1/demo/local");
  });

  it("refuses without --yes while conflicts or a held chain exist", async () => {
    const result = await importWorkspace(child, options());

    expect(result.status).toBe("conflicts");
    expect(childExists(`${WS}/src/upstream-only.ts`)).toBe(false);
    expect(readChild(`${WS}/src/index.ts`)).toContain("x = 1");
    expect(readChild(IMPORT_REPORT_PATH)).toContain(
      "Refused — unresolvable conflicts exist, nothing was written",
    );
  });

  it("confirms through deps.confirm when provided", async () => {
    const seen: number[] = [];
    const refused = await importWorkspace(child, options(), {
      confirm: async (info) => {
        seen.push(info.conflictCount, info.heldCount);
        return false;
      },
    });
    expect(refused.status).toBe("conflicts");
    expect(seen).toEqual([3, 2]);

    const approved = await importWorkspace(child, options(), { confirm: async () => true });
    expect(approved.status).toBe("imported");
    expect(childExists(`${WS}/src/upstream-only.ts`)).toBe(true);
  });

  it("applies with --yes, merges package.json, and holds the migration chain", async () => {
    rmSync(child, { recursive: true, force: true });
    child = makeChild();

    const result = await importWorkspace(child, options({ yes: true }));

    expect(result.status).toBe("imported");
    expect(readChild(`${WS}/src/index.ts`)).toContain("x = 2");
    expect(readChild(`${WS}/src/contract.ts`)).toContain('from "./contract/upstream.contract"');
    expect(readChild(`${WS}/src/contract.ts`)).not.toContain("/v1/demo/local");
    expect(readChild(`${WS}/src/contract/upstream.contract.ts`)).toContain("/v1/demo/upstream");

    const pkg = JSON.parse(readChild(`${WS}/package.json`)) as {
      version: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.dependencies["left-pad"]).toBe("^2.0.0");
    expect(pkg.dependencies["right-pad"]).toBe("^1.0.0");
    expect(pkg.dependencies["only-local"]).toBe("^1.0.0");

    expect(childExists(`${WS}/src/local-only.ts`)).toBe(true);
    expect(childExists(`${WS}/src/db/migrations/0001_upstream_diff.sql`)).toBe(false);
    expect(childExists(`${WS}/src/db/migrations/0001_local_extra.sql`)).toBe(true);
    const appliedJournal = JSON.parse(readChild(`${WS}/src/db/migrations/meta/_journal.json`)) as {
      entries: Array<{ tag: string }>;
    };
    expect(appliedJournal.entries.map((entry) => entry.tag)).toEqual([
      "0000_base",
      "0001_local_extra",
    ]);

    expect(result.backupDir).toBeTypeOf("string");
    const backupIndex = readFileSync(
      join(result.backupDir as string, `${WS}/src/index.ts`),
      "utf-8",
    );
    expect(backupIndex).toContain("x = 1");

    const snapshot = JSON.parse(readChild(".bos/import-snapshot.json")) as {
      workspaces: Record<string, { files: Record<string, string> }>;
    };
    const files = snapshot.workspaces[WS]?.files ?? {};
    expect(files[`${WS}/src/index.ts`]).toBeTypeOf("string");
    expect(files[`${WS}/package.json`]).toBeTypeOf("string");
    expect(files[`${WS}/src/shared.ts`]).toBeTypeOf("string");
    expect(files[`${WS}/src/db/migrations/meta/_journal.json`]).toBeUndefined();
    expect(files[`${WS}/src/db/migrations/0001_upstream_diff.sql`]).toBeUndefined();
    expect(files[`${WS}/src/local-only.ts`]).toBeUndefined();

    const report = readChild(IMPORT_REPORT_PATH);
    expect(report).toContain("Applied — upstream written over shared files");
    expect(report).toContain("Migration chain held back");
  });

  it("converges on a second run except for the held journal", async () => {
    const result = await importWorkspace(child, options({ dryRun: true }));

    expect(result.status).toBe("dry-run");
    expect(result.conflicts).toEqual([`${WS}/src/db/migrations/meta/_journal.json`]);
    expect(result.unchanged).toEqual([
      `${WS}/src/contract.ts`,
      `${WS}/src/contract/upstream.contract.ts`,
      `${WS}/src/db/migrations/0000_base.sql`,
      `${WS}/src/index.ts`,
      `${WS}/src/shared.ts`,
      `${WS}/src/upstream-only.ts`,
    ]);
    expect(result.merged).toEqual([`${WS}/package.json`]);
    expect(result.routeDelta).toEqual({ oursOnly: [], theirsOnly: [] });
    expect(result.heldBackMigrations).toEqual([
      `${WS}/src/db/migrations/0001_upstream_diff.sql`,
      `${WS}/src/db/migrations/meta/_journal.json`,
    ]);
  });

  it("errors loudly when the workspace is missing from the source", async () => {
    const result = await importWorkspace(child, options({ workspace: "plugins/absent" }));
    expect(result.status).toBe("error");
    expect(result.error).toContain("not found");
  });
});
