import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Cause, Effect, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importWorkspace } from "../../src/cli/import";
import type { ImportOptions } from "../../src/contract";
import { detectDrift, loadMigrations, type MigrationStorage, runMigrations } from "../../src/db";

const WS = "plugins/demo";
const M = `${WS}/src/db/migrations`;
const JOURNAL: MigrationStorage = {
  schema: "drizzle",
  table: "__drizzle_migrations",
  slug: "test",
} as const;

const writeTree = (root: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const sql = (table: string) => `CREATE TABLE ${table} (id int);\n`;

const SHARED_TABLES = Array.from(
  { length: 11 },
  (_, idx) => `shared_${String(idx).padStart(2, "0")}`,
);

const journalFor = (tags: string[]): string =>
  json({
    version: "7",
    dialect: "postgresql",
    entries: tags.map((tag, idx) => ({
      idx,
      version: "7",
      when: 1_700_000_000_000 + idx,
      tag,
      breakpoints: true,
    })),
  });

function makeChild(): string {
  const root = mkdtempSync(join(tmpdir(), "import-chain-child-"));
  const files: Record<string, string> = {
    [`${M}/meta/_journal.json`]: journalFor([
      ...SHARED_TABLES.map((table) => `00${SHARED_TABLES.indexOf(table)}_shared`),
      "0011_default-community-teams",
      "0012_onboarding-redemption-new-member",
    ]),
  };
  SHARED_TABLES.forEach((table, idx) => {
    files[`${M}/00${idx}_shared.sql`] = sql(table);
  });
  files[`${M}/0011_default-community-teams.sql`] = sql("default_community_teams");
  files[`${M}/0012_onboarding-redemption-new-member.sql`] = sql("onboarding_redemption_new_member");
  writeTree(root, files);
  return root;
}

function makeUpstream(): string {
  const root = mkdtempSync(join(tmpdir(), "import-chain-upstream-"));
  const files: Record<string, string> = {
    [`${M}/meta/_journal.json`]: journalFor([
      ...SHARED_TABLES.map((table) => `00${SHARED_TABLES.indexOf(table)}_shared`),
      "0011_team-member-role",
      "0012_gifted_nicolaos",
      "0013_sleepy_komodo",
    ]),
  };
  SHARED_TABLES.forEach((table, idx) => {
    files[`${M}/00${idx}_shared.sql`] = sql(table);
  });
  files[`${M}/0011_team-member-role.sql`] = sql("team_member_role");
  files[`${M}/0012_gifted_nicolaos.sql`] = sql("gifted_nicolaos");
  files[`${M}/0013_sleepy_komodo.sql`] = sql("sleepy_komodo");
  writeTree(root, files);
  return root;
}

function makeDb() {
  return drizzle(new PGlite());
}

async function runMigration<T, E>(effect: Effect.Effect<T, E>): Promise<T> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

describe("bos import — migration chain applies cleanly after reconciliation", () => {
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

  it("applies exactly the appended migrations and reports healthy drift", async () => {
    const db = makeDb();

    const before = await runMigration(
      loadMigrations({ fromDir: join(child, WS, "src", "db") }).pipe(
        Effect.flatMap((loaded) => runMigrations(db, loaded.migrations, { journal: JOURNAL })),
      ),
    );
    expect(before.applied).toBe(13);

    const options: ImportOptions = {
      workspace: WS,
      from: upstream,
      yes: true,
      dryRun: false,
      noInstall: true,
      json: false,
    };
    const result = await importWorkspace(child, options);
    expect(result.status).toBe("imported");
    expect(result.migrationReconciliation?.kept).toHaveLength(13);
    expect(result.migrationReconciliation?.appended).toEqual([
      { idx: 13, fromTag: "0011_team-member-role", toTag: "0013_team-member-role" },
      { idx: 14, fromTag: "0012_gifted_nicolaos", toTag: "0014_gifted_nicolaos" },
      { idx: 15, fromTag: "0013_sleepy_komodo", toTag: "0015_sleepy_komodo" },
    ]);
    expect(result.heldBackMigrations).toEqual([]);

    const after = await runMigration(
      loadMigrations({ fromDir: join(child, WS, "src", "db") }).pipe(
        Effect.flatMap((loaded) => runMigrations(db, loaded.migrations, { journal: JOURNAL })),
      ),
    );
    expect(after.applied).toBe(3);
    expect(after.total).toBe(16);

    const drift = await runMigration(
      loadMigrations({ fromDir: join(child, WS, "src", "db") }).pipe(
        Effect.flatMap((loaded) => detectDrift(db, loaded.migrations, JOURNAL)),
      ),
    );
    expect(drift.status).toBe("healthy");
  });
});
