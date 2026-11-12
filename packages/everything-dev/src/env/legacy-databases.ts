import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Data, Effect } from "effect";
import { PGLITE_DEFAULT_URL, pgliteDefaultUrlForSlug } from "../db/binding";
import { normalizeDatabaseSlug, PGLITE_TEST_DATABASE_URL } from "../services/infra";

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
 * file-backed PGlite data dir per workspace (`.bos/db/<slug>`), tests run on
 * in-memory pglite. `bos dev` repairs leftover state once, idempotently:
 *   1. `.env` lines whose URL matches the conventional shape (user, host,
 *      and database name — port too, but drift ports like 5532 from the old
 *      +100 allocator also match by name) are rewritten to the per-identity
 *      defaults. Any other `postgres://` URL is operator-owned and left alone.
 *   2. `.env` lines where two or more `*_DATABASE_URL` secrets share the one
 *      legacy pglite dir (`pglite:.bos/db`) are rewritten to per-identity
 *      subdirs — multiple live PGlite instances on one data dir silently
 *      corrupt committed data (ADR 0044). Only the exact legacy literal is
 *      rewritten; operator-authored pglite URLs are left to the preflight
 *      tripwire, which fails loudly on any remaining same-dir set.
 *   3. A leftover scaffold-shaped `docker-compose.yml` is moved to
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
        for (const [key, to] of rewrittenSharedPgliteValues(parsed)) {
          if (!rewritten.has(key)) rewritten.set(key, to);
        }
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

function legacyMappingForUrl(secret: string, rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return undefined;
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return undefined;
    if (url.username !== "everythingdev" || url.password !== "everythingdev") return undefined;
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!LEGACY_DATABASE_NAME.test(databaseName)) return undefined;
    return databaseName.endsWith("_test_db")
      ? PGLITE_TEST_DATABASE_URL
      : pgliteDefaultUrlForSlug(normalizeDatabaseSlug(secret));
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
    const match = value ? legacyMappingForUrl(key, value) : undefined;
    if (match !== undefined) {
      const rawLine = new RegExp(`^${key}=.+$`, "m").test(input.raw);
      if (rawLine) rewritten.set(key, match);
    }
  }
  return rewritten;
}

/**
 * The pre-ADR-0044 scaffold pinned every workspace to one shared PGlite data
 * dir (`pglite:.bos/db`). Multiple live PGlite instances on one data dir
 * silently corrupt committed data (heap/index divergence — ADR 0044), so when
 * two or more `*_DATABASE_URL` secrets share the legacy dir, each pin is
 * rewritten to its per-identity subdir. Only the exact legacy literal is
 * rewritten; anything operator-authored is left alone for the preflight
 * tripwire. A rewrite is also skipped when its target dir is occupied by a
 * pin that stays — a safe partial repair beats a new collision.
 */
export function rewrittenSharedPgliteValues(file: Record<string, string>): Map<string, string> {
  const byDir = new Map<string, string[]>();
  for (const [key, value] of Object.entries(file)) {
    if (!key.endsWith("_DATABASE_URL") || !value?.startsWith("pglite:")) continue;
    const rawDir = value.slice("pglite:".length);
    if (rawDir === ":memory:" || rawDir.endsWith("/:memory:")) continue;
    const dir = resolve(rawDir);
    const secrets = byDir.get(dir);
    if (secrets) secrets.push(key);
    else byDir.set(dir, [key]);
  }

  const rewritten = new Map<string, string>();
  for (const secrets of byDir.values()) {
    if (secrets.length < 2) continue;
    for (const secret of secrets) {
      if (file[secret] !== PGLITE_DEFAULT_URL) continue;
      const target = pgliteDefaultUrlForSlug(normalizeDatabaseSlug(secret));
      const targetDir = resolve(target.slice("pglite:".length));
      const occupant = byDir.get(targetDir);
      if (occupant?.some((other) => other !== secret && !rewritten.has(other))) continue;
      rewritten.set(secret, target);
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
