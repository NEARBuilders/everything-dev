import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    // Isolated tmp dir: a real pglite data dir used to live under the
    // workspace's shared `.bos/db/guard-probe`, and its close-checkpoint
    // raced the cleanup rm into cross-file ENOENT suite-deaths. Relative
    // spelling resolves against cwd, so the test chdirs into its own tmp
    // dir (the default forks pool isolates per file) and restores it; the
    // workspace tree is never touched.
    const dir = tempDir("everything-dev-pglite-guard-spelling-");
    const previousCwd = process.cwd();
    process.chdir(dir);
    // Built from process.cwd() AFTER the chdir — cwd is realpath'd, and the
    // guard key is resolve()-based, so both spellings must share the same
    // real path (macOS /var → /private/var would otherwise fork the keys).
    const probeDir = join(process.cwd(), ".bos", "db", "guard-probe");
    try {
      const first = await createDatabaseDriver("pglite:.bos/db/guard-probe", {}, undefined);
      try {
        await expect(
          createDatabaseDriver(`pglite:file://${probeDir}`, {}, undefined),
        ).rejects.toThrow(/already open in this process/);
      } finally {
        await first.close();
      }
    } finally {
      process.chdir(previousCwd);
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

describe("pglite data dir Postgres-major diagnosis (ADR 0044)", () => {
  it("names both Postgres majors when a persistent data dir cannot open, and frees the dir for a retry", async () => {
    const dir = join(tempDir("everything-dev-pglite-major-"), "old");
    mkdirSync(dir);
    writeFileSync(join(dir, "PG_VERSION"), "16\n");
    const { PGlite } = await import("@electric-sql/pglite");
    const probe = new PGlite();
    await probe.waitReady;
    const runningMajor = String(
      (await probe.query("SHOW server_version")).rows[0]?.server_version,
    ).split(".")[0];
    await probe.close();

    const open = (): Promise<unknown> =>
      createDatabaseDriver(`pglite:${dir}`, {}, undefined).then(
        () => undefined,
        (error: unknown) => error,
      );
    const failure = await open();

    expect(failure).toBeInstanceOf(Error);
    const error = failure as Error;
    expect(error.message).toContain(`"${dir}"`);
    expect(error.message).toContain("initialized by PostgreSQL 16");
    expect(error.message).toContain(`runs PostgreSQL ${runningMajor}`);
    expect(error.cause).toBeInstanceOf(Error);

    const retry: unknown = await open();
    expect((retry as Error).message).toContain("initialized by PostgreSQL 16");
  });
});
