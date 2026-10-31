import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseDriver } from "../../src/db/driver";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("file-backed pglite driver persistence", () => {
  it("persists data across driver close/reopen on the same data dir", async () => {
    const dir = tempDir("everything-dev-pglite-persist-");
    const url = `pglite:file://${dir}`;

    const first = await createDatabaseDriver(url, {}, undefined);
    await first.db.execute(sql`CREATE TABLE probe AS SELECT 'marker-1' AS v`);
    await first.close();

    const second = await createDatabaseDriver(url, {}, undefined);
    const read = await second.db.execute<{ v: string }>(sql`SELECT v FROM probe`);
    expect(read.rows).toEqual([{ v: "marker-1" }]);
    await second.close();
  });

  it("creates missing directory prefixes recursively for a relative url", async () => {
    try {
      const write = await createDatabaseDriver("pglite:.bos/db", {}, undefined);
      await write.db.execute(sql`CREATE TABLE rel_probe AS SELECT 'marker-2' AS v`);
      await write.close();

      const reopened = await createDatabaseDriver("pglite:.bos/db", {}, undefined);
      const read = await reopened.db.execute<{ v: string }>(sql`SELECT v FROM rel_probe`);
      expect(read.rows).toEqual([{ v: "marker-2" }]);
      await reopened.close();
    } finally {
      rmSync(join(".bos", "db"), { recursive: true, force: true });
    }
  });

  it("keeps namespace schema isolation on the shared data dir", async () => {
    const dir = tempDir("everything-dev-pglite-ns-");
    const url = `pglite:file://${dir}`;

    const alpha = await createDatabaseDriver(url, {}, "plugin_alpha");
    await alpha.db.execute(sql`CREATE TABLE plugin_alpha.marked AS SELECT 1 AS v`);
    await alpha.close();

    const beta = await createDatabaseDriver(url, {}, "plugin_beta");
    const listed = await beta.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'plugin_beta'`,
    );
    expect(listed.rows).toEqual([]);
    await beta.close();
  });
});
