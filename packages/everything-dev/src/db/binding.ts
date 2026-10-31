import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseDotenv } from "dotenv";
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
 * The zero-config local database: a persistent, file-backed PGlite data dir
 * resolved per workspace process (`.bos/db` relative to the workspace cwd).
 * No ports, no docker — concurrent projects never collide.
 */
export const PGLITE_DEFAULT_URL = "pglite:.bos/db";

/**
 * drizzle-kit dialect options for a resolved database URL: `pglite:` URLs use
 * the `pglite` dialect with a `driver`-tagged data-dir path; anything else is
 * a regular postgres DSN.
 */
export function drizzleCredentialsFor(url: string): {
  dialect: "postgresql" | "pglite";
  dbCredentials: { url: string; driver?: "pglite" };
} {
  if (url.startsWith("pglite:")) {
    return {
      dialect: "pglite",
      dbCredentials: { driver: "pglite", url: url.replace("pglite:", "") },
    };
  }
  return { dialect: "postgresql", dbCredentials: { url } };
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
 *   3. the persistent local default (`PGLITE_DEFAULT_URL`) — valid for
 *      connecting commands too, so `pnpm run db:migrate`/`db:studio` work
 *      zero-config against the workspace's `.bos/db` data dir
 *
 * drizzle-kit commands the default works for are unaffected; non-drizzle-kit
 * consumers get the same persistent default.
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

  return PGLITE_DEFAULT_URL;
}
