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

describe("pglite double-open guard (ADR 0044)", () => {
  it("refuses a second concurrent driver on the same data dir", async () => {
    const dir = tempDir("everything-dev-pglite-guard-");
    const url = `pglite:file://${dir}`;

    const first = await createDatabaseDriver(url, {}, undefined);
    try {
      await expect(createDatabaseDriver(url, {}, undefined)).rejects.toThrow(
        /already open in this process.*silently corrupt/s,
      );
    } finally {
      await first.close();
    }
  });

  it("normalizes relative and absolute spellings to the same guard key", async () => {
    const probeDir = join(process.cwd(), ".bos", "db", "guard-probe");
    cleanups.push(() => rmSync(probeDir, { recursive: true, force: true }));

    const first = await createDatabaseDriver("pglite:.bos/db/guard-probe", {}, undefined);
    try {
      await expect(
        createDatabaseDriver(`pglite:file://${probeDir}`, {}, undefined),
      ).rejects.toThrow(/already open in this process/);
    } finally {
      await first.close();
    }
  });

  it("allows sequential close→reopen on the same data dir", async () => {
    const dir = tempDir("everything-dev-pglite-guard-reopen-");
    const url = `pglite:file://${dir}`;

    const first = await createDatabaseDriver(url, {}, undefined);
    await first.db.execute(sql`CREATE TABLE guard_probe AS SELECT 'marker' AS v`);
    await first.close();

    const second = await createDatabaseDriver(url, {}, undefined);
    const read = await second.db.execute<{ v: string }>(sql`SELECT v FROM guard_probe`);
    expect(read.rows).toEqual([{ v: "marker" }]);
    await second.close();
  });

  it("allows concurrent drivers on distinct data dirs", async () => {
    const dirA = tempDir("everything-dev-pglite-guard-a-");
    const dirB = tempDir("everything-dev-pglite-guard-b-");

    const a = await createDatabaseDriver(`pglite:file://${dirA}`, {}, undefined);
    const b = await createDatabaseDriver(`pglite:file://${dirB}`, {}, undefined);
    await a.db.execute(sql`SELECT 1`);
    await b.db.execute(sql`SELECT 1`);
    await a.close();
    await b.close();
  });

  it("exempts in-memory instances — instances never share state", async () => {
    const a = await createDatabaseDriver("pglite::memory:", {}, undefined);
    const b = await createDatabaseDriver("pglite::memory:", {}, undefined);
    await a.db.execute(sql`SELECT 1`);
    await b.db.execute(sql`SELECT 1`);
    await a.close();
    await b.close();
  });
});
