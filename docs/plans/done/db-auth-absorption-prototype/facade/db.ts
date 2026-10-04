import { Context, Data, Effect, Layer } from "effect";
import { pluginSchemaName } from "./slug";

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  cause: unknown;
  stage: "connect" | "migrate";
}> {}

export interface DriverClient {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  exec?(sql: string): Promise<void>;
  close?(): Promise<void>;
}

export interface Driver {
  client: DriverClient;
  schemaName: string | undefined;
}

export class DatabaseService extends Context.Service<DatabaseService, DriverClient>()(
  "every-plugin/Database",
) {}

export interface Migration {
  journal: string;
  sql: string;
}

async function createPgliteDriver(url: string, schemaName: string | undefined): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  const client =
    url === "pglite://:memory:" || url === ":memory:" ? new PGlite() : new PGlite(url);
  if (schemaName) {
    await client.exec(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    await client.exec(`SET search_path TO ${schemaName}, public`);
  }
  return {
    client: {
      query: (sql) => client.query(sql) as Promise<{ rows: Record<string, unknown>[] }>,
      exec: (sql) => client.exec(sql) as unknown as Promise<void>,
      close: () => client.close(),
    },
    schemaName,
  };
}

async function createPostgresDriver(url: string, schemaName: string | undefined): Promise<Driver> {
  const pg = await import("pg");
  const pool = new pg.Pool({
    connectionString: url,
    ...(schemaName ? { options: `-c search_path="${schemaName},public"` } : {}),
  });
  return {
    client: {
      query: (sql) => pool.query(sql) as Promise<{ rows: Record<string, unknown>[] }>,
      close: () => pool.end(),
    },
    schemaName,
  };
}

export async function createDatabaseDriver(
  url: string,
  schemaName?: string,
): Promise<Driver> {
  if (url.startsWith("pglite:") || url === ":memory:") {
    return createPgliteDriver(url, schemaName);
  }
  return createPostgresDriver(url, schemaName);
}

export async function runMigrations(
  driver: Driver,
  migrations: Migration[],
): Promise<{ applied: string[]; skipped: string[] }> {
  const { client, schemaName } = driver;
  const journalSchema = schemaName ?? "public";
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${journalSchema}`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${journalSchema}.__drizzle_migrations (hash text PRIMARY KEY, created_at bigint)`,
  );
  const existing = new Set(
    (await client.query(`SELECT hash FROM ${journalSchema}.__drizzle_migrations`)).rows.map(
      (row) => String(row.hash),
    ),
  );
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const migration of migrations) {
    if (existing.has(migration.journal)) {
      skipped.push(migration.journal);
      continue;
    }
    if (client.exec) {
      await client.exec(migration.sql);
    } else {
      await client.query(migration.sql);
    }
    await client.query(
      `INSERT INTO ${journalSchema}.__drizzle_migrations (hash, created_at) VALUES ('${migration.journal}', ${Date.now()})`,
    );
    applied.push(migration.journal);
  }
  return { applied, skipped };
}

export interface DatabaseLiveOptions {
  pluginId: string;
  migrations?: Migration[];
  schemaIsolation?: boolean;
}

export const DatabaseLive = (url: string, options: DatabaseLiveOptions) =>
  Layer.effect(
    DatabaseService,
    Effect.gen(function* () {
      const schemaName =
        options.schemaIsolation === false ? undefined : pluginSchemaName(options.pluginId);
      const migrations = options.migrations ?? [];
      const driver = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => createDatabaseDriver(url, schemaName),
          catch: (cause) => new DatabaseError({ cause, stage: "connect" }),
        }),
        (d) => Effect.promise(() => d.client.close?.() ?? Promise.resolve()),
      );
      if (migrations.length > 0) {
        yield* Effect.tryPromise({
          try: () => runMigrations(driver, migrations),
          catch: (cause) => new DatabaseError({ cause, stage: "migrate" }),
        });
      }
      return driver.client;
    }),
  );
