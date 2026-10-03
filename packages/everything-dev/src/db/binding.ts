import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseDotenv } from "dotenv";
import type { WorkspaceIdentity } from "./identity";

/**
 * drizzle-kit subcommands that open a database connection. For everything
 * else (generate, check) the connection string is parsed but never used, so a
 * placeholder is safe.
 */
const DB_REQUIRING_COMMANDS: ReadonlySet<string> = new Set([
  "push",
  "pull",
  "migrate",
  "studio",
  "up",
]);

/**
 * Whether the current process is a drizzle-kit invocation whose command needs
 * a live database. Mirrors drizzle-kit's CLI layout: `drizzle-kit <command> …`.
 */
export function requiresDatabaseConnection(argv: readonly string[] = process.argv): boolean {
  const isDrizzleKit = typeof argv[1] === "string" && argv[1].includes("drizzle-kit");
  if (!isDrizzleKit) return false;
  const command = argv[2];
  return typeof command === "string" && DB_REQUIRING_COMMANDS.has(command);
}

/**
 * Materialize the environment a spawned tool needs to reach the binding's
 * database: the canonical secret name mapped to the resolved URL. The process
 * that resolves bindings (the CLI composition root) pushes this into spawned
 * children so they never re-derive secrets from ambient state.
 */
export function bindingEnv(binding: { secretName: string; url: string }): Record<string, string> {
  return { [binding.secretName]: binding.url };
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
 *   3. loud failure when the drizzle-kit command needs a database
 *   4. an in-memory pglite placeholder for commands that never connect
 *      (generate, check) and for non-drizzle-kit consumers
 *
 * This replaces the previous silent `pglite:` fallback that masked missing
 * configuration as cryptic driver errors downstream.
 */
export function resolveDatabaseUrl(
  identity: WorkspaceIdentity,
  options: {
    env?: Record<string, string | undefined>;
    argv?: readonly string[];
  } = {},
): string {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;

  const direct = env[identity.secretName];
  if (direct) return direct;

  const envFile = findEnvFile(identity.workspaceDir);
  if (envFile) {
    try {
      const parsed = parseDotenv(readFileSync(envFile, "utf-8"));
      const fromFile = parsed[identity.secretName];
      if (fromFile) return fromFile;
    } catch {
      // unreadable .env — fall through to loud failure / placeholder
    }
  }

  if (requiresDatabaseConnection(argv)) {
    throw new Error(
      `Missing ${identity.secretName} for workspace "${identity.slug}" — ` +
        `required for "drizzle-kit ${argv[2]}". ` +
        `Add ${identity.secretName} to your .env (see .env.example) or run via \`bos db\`.`,
    );
  }

  return `pglite:.bos/${identity.slug}/:memory:`;
}
