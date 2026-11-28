import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseBinding, DatabaseBindingsService } from "../../src/db/bindings";
import { DatabaseBindings, makeDatabaseBindings } from "../../src/db/bindings";
import type { DrizzleKitService } from "../../src/db/drizzle-kit";
import { DrizzleKit, makeDrizzleKitLive } from "../../src/db/drizzle-kit";
import { workspaceIdentityFromWorkspaceDir } from "../../src/db/identity";
import { diagnosePlugin, type SqlExecutor } from "../../src/services/db/doctor";
import type { MigrationDatabase } from "../../src/db/run-migrations";
import { repairPlugin } from "../../src/services/db/repair";
import type { RuntimeConfig } from "../../src/types";

const pgMock = vi.hoisted(() => ({
  mockDb: undefined as
    | { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }
    | undefined,
}));

vi.mock("pg", () => ({
  Pool: class {
    async query(text: string, params?: unknown[]) {
      const db = pgMock.mockDb;
      if (!db) throw new Error("mock pg.Pool: no mockDb set for this test");
      return db.query(text, params);
    }
    async end() {
      return undefined;
    }
  },
}));

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  pgMock.mockDb = undefined;
});

function tempWorkspace(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "everything-dev-svc-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name })}\n`);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixtureRuntimeConfig(localWidgetsDir: string): RuntimeConfig {
  return {
    env: "development",
    account: "test.near",
    networkId: "testnet",
    host: { name: "host", url: "http://localhost:3000", entry: "./index", source: "local" },
    ui: { name: "ui", url: "http://localhost:3003", entry: "./index", source: "local" },
    api: {
      name: "api",
      url: "http://localhost:3001",
      entry: "./index",
      source: "local",
      secrets: ["API_DATABASE_URL"],
    },
    auth: {
      name: "auth",
      url: "http://localhost:3002",
      entry: "./index",
      source: "remote",
      secrets: ["AUTH_DATABASE_URL"],
    },
    plugins: {
      widgets: {
        name: "widgets",
        url: "http://localhost:3110",
        entry: "./index",
        source: "local",
        localPath: localWidgetsDir,
        secrets: ["WIDGETS_DATABASE_URL"],
      },
      proposals: {
        name: "proposals",
        url: "http://localhost:3111",
        entry: "./index",
        source: "remote",
        secrets: ["PROPOSALS_DATABASE_URL"],
      },
    },
  } as unknown as RuntimeConfig;
}

function makeBindings(
  runtimeConfig: RuntimeConfig,
  env: Record<string, string | undefined>,
): DatabaseBindingsService {
  return Effect.runSync(
    DatabaseBindings.pipe(
      Effect.provide(
        makeDatabaseBindings({
          projectDir: "/virtual/project",
          loadRuntimeConfig: async () => runtimeConfig,
          env,
        }),
      ),
    ),
  );
}

function buildDrizzleKit(projectDir: string): DrizzleKitService {
  return Effect.runSync(DrizzleKit.pipe(Effect.provide(makeDrizzleKitLive({ projectDir }))));
}

async function expectFailure<A, E extends Error>(effect: Effect.Effect<A, E>): Promise<unknown> {
  try {
    await Effect.runPromise(effect);
  } catch (error) {
    return error;
  }
  throw new Error("expected effect to fail");
}

describe("DatabaseBindings.forPluginKey", () => {
  it("resolves a local plugin's binding from its workspace identity", async () => {
    const widgetsDir = tempWorkspace("@everything-dev/widgets-plugin");
    const bindings = makeBindings(fixtureRuntimeConfig(widgetsDir), {
      WIDGETS_DATABASE_URL: "postgres://u:p@localhost:5432/widgets_db",
    });

    const binding = await Effect.runPromise(bindings.forPluginKey("widgets"));

    expect(binding.key).toBe("widgets");
    expect(binding.source).toBe("local");
    expect(binding.section).toBe("plugins");
    expect(binding.identity.slug).toBe("widgets");
    expect(binding.identity.secretName).toBe("WIDGETS_DATABASE_URL");
    expect(binding.identity.workspaceDir).toBe(widgetsDir);
    expect(binding.url).toBe("postgres://u:p@localhost:5432/widgets_db");
  });

  it("resolves api and auth sections", async () => {
    const bindings = makeBindings(fixtureRuntimeConfig("/unused"), {
      API_DATABASE_URL: "postgres://api",
      AUTH_DATABASE_URL: "postgres://auth",
    });

    const api = await Effect.runPromise(bindings.forPluginKey("api"));
    const auth = await Effect.runPromise(bindings.forPluginKey("auth"));

    expect(api.section).toBe("app.api");
    expect(api.identity.secretName).toBe("API_DATABASE_URL");
    expect(api.identity.workspaceDir).toBeUndefined();
    expect(auth.section).toBe("app.auth");
    expect(auth.source).toBe("remote");
  });

  it("resolves remote-only plugins by config key", async () => {
    const bindings = makeBindings(fixtureRuntimeConfig("/unused"), {
      PROPOSALS_DATABASE_URL: "postgres://proposals",
    });

    const binding = await Effect.runPromise(bindings.forPluginKey("proposals"));

    expect(binding.identity.slug).toBe("proposals");
    expect(binding.identity.secretName).toBe("PROPOSALS_DATABASE_URL");
    expect(binding.identity.workspaceDir).toBeUndefined();
  });

  it("fails for unknown plugins", async () => {
    const bindings = makeBindings(fixtureRuntimeConfig("/unused"), {});
    const error = await expectFailure(bindings.forPluginKey("nope"));
    expect(String(error)).toContain('Plugin "nope" not found');
  });

  it("falls back to the persistent pglite default naming the secret for a local workspace", async () => {
    const widgetsDir = tempWorkspace("@everything-dev/widgets-plugin");
    const bindings = makeBindings(fixtureRuntimeConfig(widgetsDir), {});
    const binding = await Effect.runPromise(bindings.forPluginKey("widgets"));
    expect(binding.url).toBe("pglite:.bos/db/widgets");
    expect(binding.source).toBe("local");
  });

  it("still fails loudly when the declared secret disagrees with the workspace package name", async () => {
    const widgetsDir = tempWorkspace("@everything-dev/widgets-plugin");
    const config = fixtureRuntimeConfig(widgetsDir);
    config.plugins = {
      widgets: {
        key: "widgets",
        source: "local",
        localPath: widgetsDir,
        secrets: ["SOMEONE_ELSES_DATABASE_URL"],
      },
    };
    const bindings = makeBindings(config, {});
    const error = await expectFailure(bindings.forPluginKey("widgets"));
    expect(String(error)).toContain("WIDGETS_DATABASE_URL");
    expect(String(error)).toContain("disagree");
  });

  it("still fails for a remote-only plugin with no URL", async () => {
    const bindings = makeBindings(fixtureRuntimeConfig("/unused"), {});
    const error = await expectFailure(bindings.forPluginKey("proposals"));
    expect(String(error)).toContain("remote plugin");
  });
});

describe("DrizzleKit.migrate env materialization", () => {
  it("spawns drizzle-kit with the binding's canonical secret in the environment", async () => {
    const workspaceDir = tempWorkspace("@everything-dev/widgets-plugin");
    writeFileSync(join(workspaceDir, "drizzle.config.ts"), "export default {};\n");

    const shimDir = mkdtempSync(join(tmpdir(), "everything-dev-shim-"));
    const outFile = join(shimDir, "captured-env.txt");
    writeFileSync(
      join(shimDir, "npx"),
      `#!/bin/sh\nprintf '%s' "$WIDGETS_DATABASE_URL" > "${outFile}"\n`,
    );
    chmodSync(join(shimDir, "npx"), 0o755);
    cleanups.push(() => rmSync(shimDir, { recursive: true, force: true }));

    const previousPath = process.env.PATH;
    process.env.PATH = `${shimDir}:${previousPath ?? ""}`;

    try {
      const identity = workspaceIdentityFromWorkspaceDir(workspaceDir);
      const binding: DatabaseBinding = {
        key: "widgets",
        source: "local",
        section: "plugins",
        identity,
        url: "postgres://u:p@localhost:5432/widgets_db",
      };

      const service = buildDrizzleKit("/virtual/project");
      await Effect.runPromise(service.migrate(binding));

      expect(existsSync(outFile)).toBe(true);
      expect(readFileSync(outFile, "utf-8")).toBe("postgres://u:p@localhost:5432/widgets_db");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
});

describe("DrizzleKit error paths", () => {
  it("fails when a local workspace has no drizzle.config.ts", async () => {
    const workspaceDir = tempWorkspace("@everything-dev/widgets-plugin");
    const identity = workspaceIdentityFromWorkspaceDir(workspaceDir);
    const binding: DatabaseBinding = {
      key: "widgets",
      source: "local",
      section: "plugins",
      identity,
      url: "postgres://u:p@localhost:5432/widgets_db",
    };

    const service = buildDrizzleKit("/virtual/project");
    const error = await expectFailure(service.migrate(binding));
    expect(String(error)).toContain("No drizzle.config.ts found");
  });
});

describe("npx shim mechanism", () => {
  it("resolves a fake npx from PATH under shell spawn", () => {
    const shimDir = mkdtempSync(join(tmpdir(), "everything-dev-shim2-"));
    const outFile = join(shimDir, "out.txt");
    writeFileSync(join(shimDir, "npx"), `#!/bin/sh\nprintf 'x' > "${outFile}"\n`);
    chmodSync(join(shimDir, "npx"), 0o755);
    cleanups.push(() => rmSync(shimDir, { recursive: true, force: true }));

    spawnSync("npx", ["anything"], {
      cwd: shimDir,
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ""}` },
      shell: true,
    });

    expect(readFileSync(outFile, "utf-8")).toBe("x");
  });
});

const DOCTOR_MIGRATION_SQL = 'CREATE TABLE IF NOT EXISTS "builders" (id int);\n';

function doctorMigrationHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** A fake plugin workspace with a real src/db/migrations layout for the doctor to read. */
function doctorWorkspace(name: string, withSqlFile: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "everything-dev-doctor-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name })}\n`);
  const migrationsDir = join(dir, "src", "db", "migrations");
  mkdirSync(join(migrationsDir, "meta"), { recursive: true });
  writeFileSync(
    join(migrationsDir, "meta", "_journal.json"),
    JSON.stringify({
      entries: [{ idx: 0, when: 1_700_000_000_000, tag: "0001_init" }],
    }),
  );
  if (withSqlFile) {
    writeFileSync(join(migrationsDir, "0001_init.sql"), DOCTOR_MIGRATION_SQL);
  }
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const REPAIR_MIGRATION_SQL = 'CREATE TABLE IF NOT EXISTS "builders" (id int);\n';

function repairMigrationHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const SHARED_JOURNAL = { schema: "drizzle", table: "__drizzle_migrations" } as const;

/** A fake plugin workspace with a real src/db/migrations layout the re-apply pass loads. */
function repairWorkspace(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "everything-dev-repair-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name })}\n`);
  const migrationsDir = join(dir, "src", "db", "migrations");
  mkdirSync(join(migrationsDir, "meta"), { recursive: true });
  writeFileSync(
    join(migrationsDir, "meta", "_journal.json"),
    JSON.stringify({
      entries: [{ idx: 0, when: 1_700_000_000_000, tag: "0001_init" }],
    }),
  );
  writeFileSync(join(migrationsDir, "0001_init.sql"), REPAIR_MIGRATION_SQL);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function doctorBinding(opts: {
  section: DatabaseBinding["section"];
  key: string;
  slug: string;
  workspaceDir: string;
  journal?: { schema: string; table: string };
}): DatabaseBinding {
  return {
    key: opts.key,
    source: "local",
    section: opts.section,
    identity: {
      slug: opts.slug,
      secretName: "TEST_DATABASE_URL",
      journal: opts.journal ?? {
        schema: "drizzle",
        table: `__drizzle_migrations_${opts.slug}`,
        slug: opts.slug,
      },
      workspaceDir: opts.workspaceDir,
    },
    url: "postgres://u:p@localhost:5432/unused_by_executor",
  };
}

function pgliteExecutor(pglite: PGlite): SqlExecutor {
  return {
    query: async (text, params) => {
      const result = await pglite.query(text, params as never[]);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
}

function repairBinding(opts: {
  slug: string;
  workspaceDir: string;
  journal: { schema: string; table: string };
}): DatabaseBinding {
  return {
    key: "widgets",
    source: "local",
    section: "plugins",
    identity: {
      slug: opts.slug,
      secretName: "WIDGETS_DATABASE_URL",
      journal: { ...opts.journal, slug: opts.slug },
      workspaceDir: opts.workspaceDir,
    },
    url: "postgres://u:p@localhost:5432/unused_by_mock_pool",
  };
}

async function seedJournalRows(
  pglite: PGlite,
  coords: { schema: string; table: string },
  hashes: string[],
): Promise<void> {
  await pglite.exec(`CREATE SCHEMA IF NOT EXISTS "${coords.schema}"`);
  await pglite.exec(
    `CREATE TABLE "${coords.schema}"."${coords.table}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  for (const hash of hashes) {
    await pglite.query(
      `INSERT INTO "${coords.schema}"."${coords.table}" (hash, created_at) VALUES ($1, $2)`,
      [hash, 1_700_000_000_000],
    );
  }
}

describe("db doctor data-schema resolution (#663)", () => {
  it("reports healthy when the expected tables live in the plugin's data schema", async () => {
    const pglite = new PGlite();
    const workspaceDir = doctorWorkspace("@everything-dev/widgets-plugin", true);
    await pglite.exec(`CREATE SCHEMA "plugin_widgets"`);
    await pglite.exec(`CREATE TABLE "plugin_widgets"."builders" (id int)`);
    await seedJournalRows(pglite, { schema: "drizzle", table: "__drizzle_migrations_widgets" }, [
      doctorMigrationHash(DOCTOR_MIGRATION_SQL),
    ]);

    const report = await diagnosePlugin(
      doctorBinding({ section: "plugins", key: "widgets", slug: "widgets", workspaceDir }),
      pgliteExecutor(pglite),
    );

    expect(report.diagnosis).toBe("healthy");
    expect(report.dataSchema).toBe("plugin_widgets");
    expect(report.missingTables).toEqual([]);
  });

  it("reports the v1 topology (tables in public, journal present) as drift-safe-repair — boot checks plugin_<slug>", async () => {
    const pglite = new PGlite();
    const workspaceDir = doctorWorkspace("@everything-dev/widgets-plugin", true);
    await pglite.exec(`CREATE TABLE "builders" (id int)`);
    await seedJournalRows(pglite, { schema: "drizzle", table: "__drizzle_migrations_widgets" }, [
      doctorMigrationHash(DOCTOR_MIGRATION_SQL),
    ]);

    const report = await diagnosePlugin(
      doctorBinding({ section: "plugins", key: "widgets", slug: "widgets", workspaceDir }),
      pgliteExecutor(pglite),
    );

    expect(report.diagnosis).toBe("drift-safe-repair");
    expect(report.dataSchema).toBe("plugin_widgets");
    expect(report.missingTables).toEqual(["builders"]);
    expect(report.appliedHashCount).toBe(1);
  });

  it("keeps the public topology for the api workspace", async () => {
    const pglite = new PGlite();
    const workspaceDir = doctorWorkspace("api", true);
    await pglite.exec(`CREATE TABLE "builders" (id int)`);
    await seedJournalRows(pglite, { schema: "drizzle", table: "__drizzle_migrations_api" }, [
      doctorMigrationHash(DOCTOR_MIGRATION_SQL),
    ]);

    const report = await diagnosePlugin(
      doctorBinding({ section: "app.api", key: "api", slug: "api", workspaceDir }),
      pgliteExecutor(pglite),
    );

    expect(report.diagnosis).toBe("healthy");
    expect(report.dataSchema).toBe("public");
    expect(report.missingTables).toEqual([]);
  });
});

async function journalHashes(
  pglite: PGlite,
  coords: { schema: string; table: string },
): Promise<string[]> {
  const result = await pglite.query<{ hash: string }>(
    `SELECT hash FROM "${coords.schema}"."${coords.table}" ORDER BY id`,
  );
  return result.rows.map((r) => r.hash);
}

describe("db repair history-reset scoping (#664)", () => {
  it("deletes only the target workspace's rows from the shared journal — sibling hashes survive", async () => {
    const pglite = new PGlite();
    pgMock.mockDb = pglite;
    const workspaceDir = repairWorkspace("@everything-dev/widgets-plugin");
    const targetHash = repairMigrationHash(REPAIR_MIGRATION_SQL);
    await seedJournalRows(pglite, SHARED_JOURNAL, [targetHash, "sibling-hash-a", "sibling-hash-b"]);

    const result = await repairPlugin(
      repairBinding({ slug: "widgets", workspaceDir, journal: SHARED_JOURNAL }),
      "history-reset",
      {
        openDatabase: async () => {
          throw new Error("injected-open-database-failure");
        },
      },
    );

    expect(result.status).toBe("repaired");
    expect(result.message).toContain("Automatic reapply failed");

    const rows = await journalHashes(pglite, SHARED_JOURNAL);
    expect(rows).toEqual(["sibling-hash-a", "sibling-hash-b"]);
  });

  it("reapplies migrations under the workspace's data schema, never into public", async () => {
    const pglite = new PGlite();
    pgMock.mockDb = pglite;
    const workspaceDir = repairWorkspace("@everything-dev/widgets-plugin");
    const targetHash = repairMigrationHash(REPAIR_MIGRATION_SQL);
    const ownJournal = { schema: "drizzle", table: "__drizzle_migrations_widgets" };
    await seedJournalRows(pglite, ownJournal, [targetHash]);

    const result = await repairPlugin(
      repairBinding({ slug: "widgets", workspaceDir, journal: ownJournal }),
      "history-reset",
      {
        openDatabase: async () => {
          // Mirror createDatabaseDriver's pglite namespace handling: the data
          // schema owns unqualified DDL via search_path.
          await pglite.exec(`SET search_path TO "plugin_widgets", public`);
          return { db: drizzle(pglite) as unknown as MigrationDatabase, close: async () => {} };
        },
      },
    );

    expect(result.status).toBe("repaired");
    expect(result.message).toContain("plugin_widgets");

    const namespaced = await pglite.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'plugin_widgets'`,
    );
    expect(namespaced.rows.map((r) => r.table_name)).toContain("builders");

    const sprayed = await pglite.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'builders'`,
    );
    expect(sprayed.rows).toHaveLength(0);

    expect(await journalHashes(pglite, ownJournal)).toEqual([targetHash]);
  });
});
