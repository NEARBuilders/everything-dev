import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../src/db/migrations");

interface JournalEntry {
  idx: number;
  tag: string;
}

function loadJournal(): JournalEntry[] {
  const raw = readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8");
  return (JSON.parse(raw).entries as JournalEntry[]).sort((a, b) => a.idx - b.idx);
}

function readStatements(tag: string): string[] {
  return readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function applyMigration(db: PGlite, entry: JournalEntry) {
  for (const statement of readStatements(entry.tag)) {
    await db.exec(statement);
  }
}

describe("node kind generalization migration", () => {
  let db: PGlite;
  let entries: JournalEntry[];

  beforeAll(async () => {
    db = new PGlite();
    entries = loadJournal();
    for (const entry of entries.slice(0, -1)) {
      await applyMigration(db, entry);
    }
    await db.exec(`
      INSERT INTO tenants (id, account_id, name, status, owner_kind)
      VALUES ('11111111-1111-1111-1111-111111111111', 'legacy.near', 'Legacy Tenant', 'active', 'dao');
      INSERT INTO nodes (id, kind, slug, name, parent_id, tenant_id, metadata)
      VALUES (
        '22222222-2222-2222-2222-222222222222',
        'city',
        'legacy-city',
        'Legacy City',
        NULL,
        '11111111-1111-1111-1111-111111111111',
        '{"poolAccountId":"legacy-pool.near"}'::jsonb
      );
    `);
    await applyMigration(db, entries[entries.length - 1]!);
  }, 30_000);

  it("moves the legacy kind column value into metadata.kind", async () => {
    const result = await db.query<{ kind: string | null; metadata: Record<string, unknown> }>(
      "SELECT metadata->>'kind' AS kind, metadata FROM nodes WHERE slug = 'legacy-city'",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.kind).toBe("city");
    expect(result.rows[0]?.metadata).toMatchObject({
      kind: "city",
      poolAccountId: "legacy-pool.near",
    });
  });

  it("is idempotent when replayed against the migrated schema", async () => {
    await applyMigration(db, entries[entries.length - 1]!);

    const result = await db.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM nodes WHERE slug = 'legacy-city'",
    );
    expect(result.rows[0]?.metadata).toMatchObject({
      kind: "city",
      poolAccountId: "legacy-pool.near",
    });
  });

  it("drops the node_kind enum type", async () => {
    const result = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_type WHERE typname = 'node_kind'",
    );
    expect(result.rows[0]?.count).toBe(0);
  });

  it("allows standalone nodes without a tenant", async () => {
    const result = await db.query<{ id: string }>(`
      INSERT INTO nodes (slug, name, parent_id, tenant_id, metadata)
      VALUES ('standalone-org', 'Standalone Org', NULL, NULL, '{"kind":"org"}'::jsonb)
      RETURNING id
    `);
    expect(result.rows).toHaveLength(1);
  });
});
