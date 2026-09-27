import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { findRepoRoot } from "./regression-env.mjs";

const JOURNAL_SCHEMA = "drizzle";
const JOURNAL_TABLE = "__drizzle_migrations";

/**
 * Mirrors the plugin migrate runner (each plugin's src/db/migrate.ts): same disk
 * journal layout, same sha256-of-raw-file hashes, same journal table, and the
 * same preflight that records a migration as applied when its expected tables
 * already exist. The regression suite needs this because Playwright's
 * globalSetup runs before the webServer boots the stack, and the stack is what
 * normally applies migrations at plugin init.
 */
function loadMigrationsFromDisk(migrationsDir) {
  const metaDir = join(migrationsDir, "meta");
  const journalPath = join(metaDir, "_journal.json");

  if (!existsSync(journalPath)) {
    throw new Error(`Migrations journal not found at ${journalPath}. Run \`db:generate\` first.`);
  }

  const journal = JSON.parse(readFileSync(journalPath, "utf8"));

  return journal.entries.map((entry) => {
    const sqlPath = join(migrationsDir, `${entry.tag}.sql`);
    if (!existsSync(sqlPath)) throw new Error(`Migration SQL file not found: ${sqlPath}`);
    const raw = readFileSync(sqlPath, "utf8");
    return {
      idx: entry.idx,
      when: entry.when,
      tag: entry.tag,
      hash: createHash("sha256").update(raw).digest("hex"),
      sql: raw
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  });
}

function expectedTablesOf(migration) {
  const tables = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"\.)?"([^"]+)"/gi;
  for (const stmt of migration.sql) {
    for (const match of stmt.matchAll(re)) {
      if (match[2]) tables.add(match[2]);
    }
  }
  return [...tables];
}

export async function migrateTestDatabase({ migrationsDir, databaseUrl, schemaName, repoRoot }) {
  if (!databaseUrl) throw new Error("[migrate-test-db] databaseUrl is required");
  const root = repoRoot ?? findRepoRoot();
  if (!root) throw new Error("bos.config.json not found in any parent directory");

  const migrations = loadMigrationsFromDisk(resolve(root, migrationsDir));
  if (migrations.length === 0) return 0;

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // One transaction under the same journal-scoped advisory lock the plugin
    // runner takes — this pre-migration pass and a booting stack's own
    // migration run serialize instead of colliding in pg_catalog.
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${JOURNAL_SCHEMA}.${JOURNAL_TABLE}`,
      ]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${JOURNAL_SCHEMA}"`);
      await client.query(`CREATE TABLE IF NOT EXISTS "${JOURNAL_SCHEMA}"."${JOURNAL_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )`);
      if (schemaName) {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
      }

      const appliedRows = await client.query(
        `SELECT hash FROM "${JOURNAL_SCHEMA}"."${JOURNAL_TABLE}"`,
      );
      const appliedHashes = new Set(appliedRows.rows.map((row) => row.hash));

      const searchPath = schemaName
        ? `SET search_path TO "${schemaName}", public`
        : "SET search_path TO public";
      await client.query(searchPath);

      let applied = 0;
      for (const migration of migrations) {
        if (appliedHashes.has(migration.hash) || appliedHashes.has(migration.hash.slice(0, 12))) {
          continue;
        }

        const expectedTables = expectedTablesOf(migration);
        if (expectedTables.length > 0) {
          const existing = await client.query(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = ANY($1::text[]) AND table_name = ANY($2::text[])`,
            [schemaName ? [schemaName, "public"] : ["public"], expectedTables],
          );
          const existingNames = new Set(existing.rows.map((row) => row.table_name));
          const missing = expectedTables.filter((table) => !existingNames.has(table));
          if (missing.length === 0) {
            await client.query(
              `INSERT INTO "${JOURNAL_SCHEMA}"."${JOURNAL_TABLE}" (hash, created_at) VALUES ($1, $2)`,
              [migration.hash, migration.when],
            );
            appliedHashes.add(migration.hash);
            applied++;
            continue;
          }
        }

        await client.query(`SAVEPOINT migration_${migration.idx}`);
        try {
          for (const statement of migration.sql) {
            await client.query(statement);
          }
          await client.query(
            `INSERT INTO "${JOURNAL_SCHEMA}"."${JOURNAL_TABLE}" (hash, created_at) VALUES ($1, $2)`,
            [migration.hash, migration.when],
          );
          await client.query(`RELEASE SAVEPOINT migration_${migration.idx}`);
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT migration_${migration.idx}`);
          await client.query("ROLLBACK");
          throw new Error(`[migrate-test-db] migration ${migration.tag} failed: ${error.message}`);
        }
        appliedHashes.add(migration.hash);
        applied++;
      }

      await client.query("COMMIT");
      return applied;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    await client.end();
  }
}
