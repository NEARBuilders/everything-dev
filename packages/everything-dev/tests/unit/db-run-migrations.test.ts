import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { migrate as apiMigrate } from "../../../../api/src/db/migrate";
import { migrate as authMigrate } from "../../../../plugins/auth/src/db/migrate";
import {
  type DatabaseError,
  isConcurrentDdlUniqueViolation,
  isRetryableMigrationExecutionError,
  type Migration,
  type MigrationDatabase,
  type MigrationStorage,
  runMigrations,
} from "../../src/db";

type Runner = (
  db: MigrationDatabase,
  migrations: Migration[],
  storage?: MigrationStorage,
  schemaName?: string,
) => Effect.Effect<number, DatabaseError>;

function migration(idx: number, tag: string, statements: string[]): Migration {
  return {
    idx,
    when: 1_700_000_000_000 + idx,
    tag,
    hash: `hash-${tag}`,
    sql: statements,
  };
}

function makeDb() {
  const pglite = new PGlite();
  return drizzle(pglite);
}

const JOURNAL = { schema: "drizzle", table: "__drizzle_migrations", slug: "test" } as const;

describe("db migration runners (008 characterization)", () => {
  it("fresh schema: sequential migrations apply, journal tracks hashes, rerun is a no-op", async () => {
    const db = makeDb();
    const migrations = [
      migration(0, "mig_one", ['CREATE TABLE IF NOT EXISTS "t1" (id int)']),
      migration(1, "mig_two", [
        'CREATE TABLE IF NOT EXISTS "t2" (id int)',
        'INSERT INTO "t2" (id) VALUES (1)',
      ]),
    ];

    const applied = await Effect.runPromise(apiMigrate(db as never, migrations, JOURNAL) as never);
    expect(applied).toBe(2);

    const rerun = await Effect.runPromise(apiMigrate(db as never, migrations, JOURNAL) as never);
    expect(rerun).toBe(0);

    const rows = (await db.execute(
      sql`SELECT hash FROM "drizzle"."__drizzle_migrations" ORDER BY id`,
    )) as { rows: { hash: string }[] };
    expect(rows.rows.map((r) => r.hash)).toEqual(["hash-mig_one", "hash-mig_two"]);
  });

  it("partial overlap (the 25P2 bug): every runner — including auth via the shared adapter — survives via savepoints", async () => {
    const runners: readonly Runner[] = [apiMigrate, authMigrate];
    for (const runner of runners) {
      const db = makeDb();
      await db.execute(sql.raw('CREATE TABLE "t_legacy" (id int)'));

      const migrations = [
        migration(0, "overlap", [
          'CREATE TABLE "t_legacy" (id int)',
          'CREATE TABLE "t_new" (id int)',
        ]),
      ];

      const applied = await Effect.runPromise(runner(db, migrations, JOURNAL));
      expect(applied).toBe(1);

      const exists = (await db.execute(
        sql`SELECT table_name FROM information_schema.tables WHERE table_name = 't_new'`,
      )) as { rows: unknown[] };
      expect(exists.rows).toHaveLength(1);
    }
  });

  it("preflight: migration whose expected tables all exist is recorded as applied without replaying DDL", async () => {
    const db = makeDb();
    await db.execute(sql.raw('CREATE TABLE "t_pre" (id int)'));

    const migrations = [
      migration(0, "already", ['CREATE TABLE "t_pre" (id int)']),
      migration(1, "fresh", ['CREATE TABLE "t_fresh" (id int)']),
    ];

    const applied = await Effect.runPromise(apiMigrate(db as never, migrations, JOURNAL) as never);
    expect(applied).toBe(2);

    const journal = (await db.execute(
      sql`SELECT hash FROM "drizzle"."__drizzle_migrations" ORDER BY id`,
    )) as { rows: { hash: string }[] };
    expect(journal.rows.map((r) => r.hash)).toContain("hash-already");
  });

  it("lock timeout (55P03) while blocked on the advisory lock is retried and then applies", async () => {
    const db = makeDb();
    let timeouts = 1;
    const loser = {
      execute: (query) => db.execute(query as never),
      transaction: (fn) =>
        db.transaction(
          (tx) =>
            fn({
              execute: async (query: unknown) => {
                if (timeouts > 0 && queryText(query).includes("pg_advisory_xact_lock")) {
                  timeouts--;
                  const err = new Error("canceling statement due to lock timeout");
                  (err as { code?: string }).code = "55P03";
                  throw err;
                }
                return (tx as { execute: (q: unknown) => Promise<unknown> }).execute(query);
              },
            } as never) as never,
        ),
    } as never;

    const report = await Effect.runPromise(
      runMigrations(loser, [migration(0, "locked", ['CREATE TABLE "t_locked" (id int)'])], {
        journal: JOURNAL,
      }),
    );
    expect(report.applied).toBe(1);
    expect(timeouts).toBe(0);
  });
});

const itPostgres = process.env.TEST_DATABASE === "postgres" ? it : it.skip;

describe("advisory-lock serialization (postgres-only)", () => {
  itPostgres(
    "two concurrent runners converge: exactly one journal row per hash, the loser applies 0",
    async () => {
      const { Pool } = await import("pg");
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const url =
        process.env.MIGRATION_RACE_DATABASE_URL ??
        "postgres://everythingdev:everythingdev@127.0.0.1:5434/api_test_db";
      const suffix = `${process.pid}_${Date.now()}`;
      const journal = {
        schema: "drizzle",
        table: `__migrations_race_${suffix}`,
        slug: "race",
      } as const;
      const schemaName = `plugin_race_${suffix}`;

      const pool = new Pool({ connectionString: url, max: 4 });
      const db = drizzle(pool) as never;
      try {
        const migrations = [
          migration(0, "race_one", ['CREATE TABLE "race_t1" (id int)']),
          migration(1, "race_two", ['CREATE TABLE "race_t2" (id int)']),
        ];
        const [a, b] = await Promise.all([
          Effect.runPromise(runMigrations(db, migrations, { journal, schemaName })),
          Effect.runPromise(runMigrations(db, migrations, { journal, schemaName })),
        ]);

        expect(a.applied + b.applied).toBe(2);

        const rows = (await db.execute(
          sql`SELECT hash FROM ${sql.raw(`"drizzle"."${journal.table}"`)}`,
        )) as { rows: { hash: string }[] };
        expect(new Set(rows.rows.map((r) => r.hash))).toEqual(
          new Set(["hash-race_one", "hash-race_two"]),
        );
        expect(rows.rows).toHaveLength(2);
      } finally {
        await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
        await db.execute(sql.raw(`DROP TABLE IF EXISTS "drizzle"."${journal.table}"`));
        await pool.end();
      }
    },
    30_000,
  );
});

function pgUniqueViolation(constraint: string): Error {
  const err = new Error(`duplicate key value violates unique constraint "${constraint}"`);
  (err as { code?: string }).code = "23505";
  (err as { constraint?: string }).constraint = constraint;
  return err;
}

function queryText(query: unknown): string {
  if (typeof query === "string") return query;
  const chunks = (query as { queryChunks?: unknown[] } | undefined)?.queryChunks;
  if (Array.isArray(chunks)) {
    return chunks
      .map((chunk) =>
        typeof chunk === "string" ? chunk : ((chunk as { value?: string[] })?.value ?? []).join(""),
      )
      .join("");
  }
  return "";
}

/**
 * A MigrationDatabase whose transaction hands the runner a tx that throws the
 * given pg error the first time the named table's DDL statement runs — the
 * loser's view of a concurrent `CREATE TABLE` against a fresh database.
 */
function racingLoser(
  db: ReturnType<typeof makeDb>,
  tableName: string,
  throwOnce: () => Error,
): MigrationDatabase {
  let armed = true;
  return {
    execute: (query) => db.execute(query as never),
    transaction: (fn) =>
      db.transaction(
        (tx) =>
          fn({
            execute: async (query: unknown) => {
              const text = queryText(query);
              if (armed && text.includes(`CREATE TABLE "${tableName}"`)) {
                armed = false;
                throw throwOnce();
              }
              return (tx as { execute: (q: unknown) => Promise<unknown> }).execute(query);
            },
          } as never) as never,
      ),
  } as never;
}

describe("concurrent-DDL race tolerance (23505 on pg_catalog unique indexes)", () => {
  it("loser of a concurrent CREATE TABLE (23505 on pg_type_typname_nsp_index) is tolerated and journaled", async () => {
    const db = makeDb();
    const loser = racingLoser(db, "t_race", () => pgUniqueViolation("pg_type_typname_nsp_index"));

    const report = await Effect.runPromise(
      runMigrations(loser, [migration(0, "race", ['CREATE TABLE "t_race" (id int)'])], {
        journal: JOURNAL,
      }),
    );
    expect(report.applied).toBe(1);

    const journal = (await db.execute(sql`SELECT hash FROM "drizzle"."__drizzle_migrations"`)) as {
      rows: { hash: string }[];
    };
    expect(journal.rows.map((r) => r.hash)).toContain("hash-race");
  });

  it("data-level 23505 on a user-table constraint still fails the migration", async () => {
    const db = makeDb();
    const loser = racingLoser(db, "t_session", () => pgUniqueViolation("t_session_token_key"));

    await expect(
      Effect.runPromise(
        runMigrations(loser, [migration(0, "data", ['CREATE TABLE "t_session" (id int)'])], {
          journal: JOURNAL,
        }),
      ),
    ).rejects.toThrow();
  });

  it("retryable mid-migration SQLSTATE (40P01 deadlock) is retried and then applies", async () => {
    const db = makeDb();
    let deadlocks = 1;
    const loser = racingLoser(db, "t_deadlock", () => {
      deadlocks--;
      const err = new Error("deadlock detected");
      (err as { code?: string }).code = "40P01";
      return err;
    });

    const report = await Effect.runPromise(
      runMigrations(loser, [migration(0, "deadlock", ['CREATE TABLE "t_deadlock" (id int)'])], {
        journal: JOURNAL,
      }),
    );
    expect(report.applied).toBe(1);
    expect(deadlocks).toBe(0);

    const exists = (await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_name = 't_deadlock'`,
    )) as { rows: unknown[] };
    expect(exists.rows).toHaveLength(1);
  });
});

describe("isConcurrentDdlUniqueViolation", () => {
  it("matches pg_catalog unique-index collisions, including through causes", () => {
    expect(isConcurrentDdlUniqueViolation(pgUniqueViolation("pg_type_typname_nsp_index"))).toBe(
      true,
    );
    expect(isConcurrentDdlUniqueViolation(pgUniqueViolation("pg_namespace_nspname_index"))).toBe(
      true,
    );
    expect(isConcurrentDdlUniqueViolation(pgUniqueViolation("pg_class_relname_nsp_index"))).toBe(
      true,
    );
    expect(
      isConcurrentDdlUniqueViolation({ cause: pgUniqueViolation("pg_type_typname_nsp_index") }),
    ).toBe(true);
  });

  it("does not match other states or user-table constraints", () => {
    expect(isConcurrentDdlUniqueViolation(pgUniqueViolation("t_session_token_key"))).toBe(false);
    const duplicate = new Error('relation "t" already exists');
    (duplicate as { code?: string }).code = "42P07";
    expect(isConcurrentDdlUniqueViolation(duplicate)).toBe(false);
    expect(isConcurrentDdlUniqueViolation(new Error("boom"))).toBe(false);
  });
});

describe("isRetryableMigrationExecutionError", () => {
  it("matches deadlock/serialization/lock states and connection failures", () => {
    for (const code of ["40001", "40P01", "55P03", "08001", "ECONNREFUSED"]) {
      const err = new Error("transient");
      (err as { code?: string }).code = code;
      expect(isRetryableMigrationExecutionError(err), code).toBe(true);
    }
  });

  it("does not match duplicate/unique classes — those are tolerance or fatal, not retry", () => {
    expect(isRetryableMigrationExecutionError(pgUniqueViolation("pg_type_typname_nsp_index"))).toBe(
      false,
    );
    const duplicate = new Error('relation "t" already exists');
    (duplicate as { code?: string }).code = "42P07";
    expect(isRetryableMigrationExecutionError(duplicate)).toBe(false);
  });
});
