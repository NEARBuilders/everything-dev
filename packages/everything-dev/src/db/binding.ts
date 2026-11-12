import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { normalizeSlug } from "./core";
import defaults from "./defaults.json";
import type { WorkspaceIdentity } from "./identity";

/**
 * Materialize the environment a spawned tool needs to reach the binding's
 * database: the canonical secret name mapped to the resolved URL. The process
 * that resolves bindings (the CLI composition root) pushes this into spawned
 * children so they never re-derive secrets from ambient state.
 */
export function bindingEnv(binding: { secretName: string; url: string }): Record<string, string> {
  return { [binding.secretName]: binding.url };
}

/**
 * The zero-config local database root: a persistent, file-backed PGlite data
 * dir (`.bos/db`). No ports, no docker — concurrent projects never collide.
 * This is the *layout base*, not a driver target: multiple live PGlite
 * instances on one data dir silently corrupt committed data (heap/index
 * divergence — ADR 0044), so every workspace opens its own subdirectory via
 * `pgliteDefaultUrlForSlug`. The literal remains exported for legacy-pin
 * matching (the compose-era and shared-dir rewrite in `env/legacy-databases`)
 * — never hand a driver the bare base.
 *
 * This default is a runtime-driver concern only: drizzle-kit commands
 * (db:push/db:studio/db:migrate) need a real postgres DSN in the environment.
 *
 * Single-sourced in `defaults.json` (read by plain-node tooling like the
 * regression env too) — never hardcode the literal elsewhere. Scaffolded
 * templates and plugin secret defaults deliberately keep their own frozen
 * copy: a database location is pinned at init, it must not silently follow
 * a framework upgrade.
 */
export const PGLITE_DEFAULT_URL = `pglite:${defaults.pgliteDefaultDir}`;

/**
 * The per-identity default: `<PGLITE_DEFAULT_URL>/<slug>` (e.g.
 * `pglite:.bos/db/api`, `pglite:.bos/db/agent_connect`). The slug matches the
 * `pluginMigrationSlug`/`normalizeDatabaseSlug` naming used for schemas,
 * journals, and secret names — one workspace, one data dir, collisions
 * impossible by package-name uniqueness (ADR 0044).
 */
export function pgliteDefaultUrlForSlug(slug: string): string {
  return `${PGLITE_DEFAULT_URL}/${normalizeSlug(slug)}`;
}

function findEnvFile(startDir: string | undefined): string | undefined {
  if (!startDir) return undefined;
  let current = startDir;
  for (let i = 0; i < 15; i++) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

/**
 * Resolve the connection URL for a workspace identity.
 *
 * Resolution order:
 *   1. the canonical secret in the provided environment
 *   2. the canonical secret in the nearest `.env` walked up from the
 *      workspace directory (existing environment wins — values are not
 *      overridden, matching dotenv semantics)
 *   3. the per-identity default (`pgliteDefaultUrlForSlug(identity.slug)`) —
 *      consumed by the runtime driver (`createDatabaseDriver`), so boot
 *      migrations apply zero-config against the workspace's own
 *      `.bos/db/<slug>` data dir
 *
 * drizzle-kit commands need a postgres DSN; feeding them the pglite default
 * fails loudly at connect time.
 */
export function resolveDatabaseUrl(
  identity: WorkspaceIdentity,
  options: {
    env?: Record<string, string | undefined>;
  } = {},
): string {
  const env = options.env ?? process.env;

  const direct = env[identity.secretName];
  if (direct) return direct;

  const envFile = findEnvFile(identity.workspaceDir);
  if (envFile) {
    try {
      const parsed = parseDotenv(readFileSync(envFile, "utf-8"));
      const fromFile = parsed[identity.secretName];
      if (fromFile) return fromFile;
    } catch {
      // unreadable .env — fall through to the default
    }
  }

  return pgliteDefaultUrlForSlug(identity.slug);
}
