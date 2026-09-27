import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { getMigrationStorage } from "everything-dev/db";
import { describe, expect, it } from "vitest";
import { createDatabaseDriver } from "../db/index";
import { loadMigrations, migrate } from "../db/migrate";

describe("proposals migrations", () => {
  it("upgrades legacy proposals before current lifecycle queries run", async () => {
    const driver = await createDatabaseDriver(":memory:", "plugin_proposals");
    try {
      await driver.db.execute(
        sql.raw(`
        CREATE TABLE proposal_audit_log (
          id text PRIMARY KEY, proposal_id text NOT NULL, plugin_id text NOT NULL,
          entity_id text NOT NULL, action text NOT NULL, actor text NOT NULL,
          created_at timestamptz DEFAULT now() NOT NULL
        )
      `),
      );
      await driver.db.execute(
        sql.raw(`
        CREATE TABLE proposal_submissions (
          id text PRIMARY KEY, proposal_id text NOT NULL, plugin_id text NOT NULL,
          entity_id text NOT NULL, submitted_by text NOT NULL,
          created_at timestamptz DEFAULT now() NOT NULL
        )
      `),
      );
      await driver.db.execute(
        sql.raw(`
        CREATE TABLE proposals (
          id text PRIMARY KEY, plugin_id text NOT NULL, entity_id text NOT NULL,
          payload text NOT NULL, schema_version text DEFAULT '1' NOT NULL,
          created_by text NOT NULL, review_status text DEFAULT 'pending' NOT NULL,
          apply_status text DEFAULT 'not_started' NOT NULL, rejection_reason text,
          apply_error text, applied_resource_id text, applied_at timestamptz,
          created_at timestamptz DEFAULT now() NOT NULL,
          updated_at timestamptz DEFAULT now() NOT NULL
        )
      `),
      );
      await driver.db.execute(
        sql.raw(`
        INSERT INTO proposals (id, plugin_id, entity_id, payload, created_by)
        VALUES ('proposal-pakistan', 'node', 'pakistan', '{}', 'applicant')
      `),
      );

      const initialMigration = await readFile(
        new URL("../db/migrations/0000_concerned_blade.sql", import.meta.url),
        "utf8",
      );
      const initialHash = createHash("sha256").update(initialMigration).digest("hex");
      const storage = getMigrationStorage("proposals");
      await driver.db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${storage.schema}"`));
      await driver.db.execute(
        sql.raw(`
          CREATE TABLE "${storage.schema}"."${storage.table}" (
            id serial PRIMARY KEY, hash text NOT NULL, created_at bigint
          )
        `),
      );
      await driver.db.execute(
        sql`INSERT INTO ${sql.raw(`"${storage.schema}"."${storage.table}"`)} (hash, created_at)
            VALUES (${initialHash}, 1780344361156)`,
      );

      const { migrations } = await Effect.runPromise(loadMigrations());
      await Effect.runPromise(migrate(driver.db, migrations, storage, "plugin_proposals"));

      const result = await driver.db.execute(
        sql.raw(`
        SELECT id, plugin_id, entity_id, operation, payload, schema_version, created_by,
          review_status, apply_status, remove_status, rejection_reason, apply_error,
          remove_error, applied_resource_id, applied_at, removed_at, created_at, updated_at
        FROM proposals
        WHERE plugin_id = 'node' AND entity_id = 'pakistan'
        LIMIT 1
      `),
      );
      const rows = (result as { rows?: unknown[] }).rows ?? (result as unknown[]);
      expect(rows).toEqual([
        expect.objectContaining({
          id: "proposal-pakistan",
          operation: "create",
          remove_status: "not_started",
        }),
      ]);

      await driver.db.execute(
        sql.raw(`
        INSERT INTO proposal_submissions (
          id, proposal_id, plugin_id, entity_id, submitted_by,
          source, idempotency_key, payload, metadata
        ) VALUES (
          'submission-pakistan', 'proposal-pakistan', 'node', 'pakistan', 'applicant',
          '/apply', 'pakistan-application', '{}', '{}'
        )
      `),
      );
      await driver.db.execute(
        sql.raw(`
        INSERT INTO proposal_audit_log (
          id, proposal_id, plugin_id, entity_id, action, actor, actor_label, details
        ) VALUES (
          'audit-pakistan', 'proposal-pakistan', 'node', 'pakistan',
          'submitted', 'applicant', 'Applicant', '{}'
        )
      `),
      );
    } finally {
      await driver.close();
    }
  });
});
