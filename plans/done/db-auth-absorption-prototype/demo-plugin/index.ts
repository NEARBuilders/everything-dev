import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Effect, Scope } from "effect";
import { buildScoped } from "../facade/effect-helpers";
import { DatabaseLive, DatabaseService, type DatabaseError } from "../facade/db";
import { createNotesService, type NotesService } from "./service";

export interface PluginInitializeInput {
  pluginId: string;
  variables: Record<string, unknown>;
  secrets: Record<string, string>;
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function loadMigrations() {
  return [
    {
      journal: "0000_init",
      sql: readFileSync(join(migrationsDir, "0000_init.sql"), "utf-8"),
    },
  ];
}

export const initialize = (
  config: PluginInitializeInput,
): Effect.Effect<{ notes: NotesService }, DatabaseError, Scope.Scope> =>
  Effect.gen(function* () {
    const databaseUrl = config.secrets.DEMO_DATABASE_URL ?? "pglite://:memory:";
    const db = yield* buildScoped(
      DatabaseService,
      DatabaseLive(databaseUrl, {
        pluginId: config.pluginId,
        migrations: loadMigrations(),
      }),
    );
    return { notes: createNotesService(db) };
  });
