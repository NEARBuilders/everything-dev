import { createHash } from "node:crypto";
import { Data, Effect } from "effect";
import { Client } from "pg";

export class RuntimeProvisionError extends Data.TaggedError("RuntimeProvisionError")<{
  message: string;
  cause?: unknown;
}> {}

const sanitizeDbIdentifier = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9_]/g, "_");

export function runtimeDatabaseSlug(account: string, gateway: string): string {
  const digest = createHash("sha256").update(`${account}/${gateway}`).digest("hex").slice(0, 8);
  const base = sanitizeDbIdentifier(`${account}_${gateway}`).slice(0, 40);
  return `${base}_${digest}`;
}

export function runtimeDatabaseNames(
  account: string,
  gateway: string,
): {
  apiDatabase: string;
  authDatabase: string;
} {
  const slug = runtimeDatabaseSlug(account, gateway);
  return { apiDatabase: `runtime_${slug}_api`, authDatabase: `runtime_${slug}_auth` };
}

export function runtimeDbUrl(platformUrl: string, database: string): string {
  const url = new URL(platformUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

const quoteIdent = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

const ensureDatabase = (platformUrl: string, database: string) =>
  Effect.tryPromise({
    try: async () => {
      const client = new Client({ connectionString: platformUrl });
      await client.connect();
      try {
        const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
          database,
        ]);
        if (existing.rowCount === 0) {
          await client.query(`CREATE DATABASE ${quoteIdent(database)}`);
        }
      } finally {
        await client.end();
      }
    },
    catch: (cause) =>
      new RuntimeProvisionError({ message: `Failed to provision database ${database}`, cause }),
  });

export function provisionRuntimeDatabases(input: {
  account: string;
  gateway: string;
  platformUrl: string;
}): Effect.Effect<Record<string, string>, RuntimeProvisionError> {
  if (input.platformUrl.startsWith("pglite")) {
    return Effect.succeed({});
  }
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => new URL(input.platformUrl),
      catch: (cause) =>
        new RuntimeProvisionError({
          message: `Platform database URL is not a postgres URL: ${input.platformUrl}`,
          cause,
        }),
    });
    const names = runtimeDatabaseNames(input.account, input.gateway);
    yield* ensureDatabase(input.platformUrl, names.apiDatabase);
    yield* ensureDatabase(input.platformUrl, names.authDatabase);
    return {
      API_DATABASE_URL: runtimeDbUrl(input.platformUrl, names.apiDatabase),
      AUTH_DATABASE_URL: runtimeDbUrl(input.platformUrl, names.authDatabase),
    };
  });
}
