import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Data, Effect } from "effect";
import { PGLITE_DEV_DATABASE_URL, PGLITE_TEST_DATABASE_URL } from "../services/infra";

export class LegacyMigrationError extends Data.TaggedError("LegacyMigrationError")<{
  cause: unknown;
}> {}

export interface LegacyMigrationReport {
  databaseUrlDrift: Array<{ key: string; from: string; to: string }>;
  composeRelocated: boolean;
}

/**
 * The compose-era local database convention (`bos dev` provisioned Postgres
 * via the committed docker-compose.yml): every `*_DATABASE_URL` pointed at
 * `postgres://everythingdev:everythingdev@localhost:<port>/<db>` on the
 * hardcoded 5432–5435 block. Those are exactly the opt-ins that made two
 * concurrent local projects fight over host ports.
 *
 * The compose-era convention is retired — local persistence is a
 * file-backed PGlite data dir (`.bos/db`), tests run on in-memory pglite.
 * `bos dev` repairs leftover state once, idempotently:
 *   1. `.env` lines whose URL matches the conventional shape (user, host,
 *      and database name — port too, but drift ports like 5532 from the old
 *      +100 allocator also match by name) are rewritten to the new defaults.
 *      Any other `postgres://` URL is operator-owned and left alone.
 *   2. A leftover scaffold-shaped `docker-compose.yml` is moved to
 *      `.bos/compose-retired/` rather than deleted; operator-authored
 *      compose files (different service names/images) are untouched.
 */
export const migrateLegacyComposeState = (
  configDir: string,
): Effect.Effect<LegacyMigrationReport, never> =>
  Effect.try({
    try: () => {
      const envPath = join(configDir, ".env");
      const databaseUrlDrift: LegacyMigrationReport["databaseUrlDrift"] = [];

      if (existsSync(envPath)) {
        const raw = readFileSync(envPath, "utf-8");
        const parsed = loadDotenv({ path: envPath, quiet: true }).parsed ?? {};
        const rewritten = rewrittenLegacyDatabaseValues({ file: parsed, raw });
        if (rewritten.size > 0) {
          const lines = raw.split("\n");
          const updated = lines.map((line) => {
            const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
            if (!match) return line;
            const replacement = rewritten.get(match[1]);
            return replacement === undefined ? line : `${match[1]}=${replacement}`;
          });
          writeFileSync(envPath, updated.join("\n"));
          for (const [key, to] of rewritten) {
            databaseUrlDrift.push({ key, from: parsed[key] ?? "", to });
          }
        }
      }

      const composeRelocated = relocateLegacyComposeFile(configDir);
      return { databaseUrlDrift, composeRelocated };
    },
    catch: (cause) => new LegacyMigrationError({ cause }),
  }).pipe(Effect.orElseSucceed(() => ({ databaseUrlDrift: [], composeRelocated: false })));

/** Matches the compose-era URL shapes: the scaffolded user + localhost + the convention's database names. */
const LEGACY_DATABASE_NAME = /^(api_db|auth_db|api_test_db|auth_test_db)$/;

function legacyMappingForUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return undefined;
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return undefined;
    if (url.username !== "everythingdev" || url.password !== "everythingdev") return undefined;
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!LEGACY_DATABASE_NAME.test(databaseName)) return undefined;
    return databaseName.endsWith("_test_db") ? PGLITE_TEST_DATABASE_URL : PGLITE_DEV_DATABASE_URL;
  } catch {
    return undefined;
  }
}

export function rewrittenLegacyDatabaseValues(input: {
  file: Record<string, string>;
  raw: string;
}): Map<string, string> {
  const rewritten = new Map<string, string>();
  for (const [key, value] of Object.entries(input.file)) {
    const match = value ? legacyMappingForUrl(value) : undefined;
    if (match !== undefined) {
      const rawLine = new RegExp(`^${key}=.+$`, "m").test(input.raw);
      if (rawLine) rewritten.set(key, match);
    }
  }
  return rewritten;
}

const SCAFFOLD_SERVICE_NAMES = new Set([
  "postgres-api",
  "postgres-auth",
  "postgres-api-test",
  "postgres-auth-test",
]);
const SCAFFOLD_IMAGE_HINTS = [
  "public.ecr.aws/docker/library/postgres",
  "docker.io/library/postgres",
  "postgres:17-alpine",
  "ghcr.io/nearbuilders/mirror-postgres",
];

function isScaffoldComposeFile(raw: string): boolean {
  const services = [...raw.matchAll(/^\s+-?\s*([a-z-]+):\s*$/gm)].map((match) => match[1] ?? "");
  if (!services.some((name) => SCAFFOLD_SERVICE_NAMES.has(name))) return false;
  return SCAFFOLD_IMAGE_HINTS.some((hint) => raw.includes(hint));
}

function relocateLegacyComposeFile(configDir: string): boolean {
  const composePath = join(configDir, "docker-compose.yml");
  if (!existsSync(composePath)) return false;
  let raw: string;
  try {
    raw = readFileSync(composePath, "utf-8");
  } catch {
    return false;
  }
  if (!isScaffoldComposeFile(raw)) return false;
  const retiredDir = join(configDir, ".bos", "compose-retired");
  mkdirSync(retiredDir, { recursive: true });
  renameSync(composePath, join(retiredDir, "docker-compose.yml"));
  return true;
}
