import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDatabaseDriver } from "../../src/db/driver";

/**
 * Sandboxed workspaces for the seed-phase tests (#865). Sandboxes live under
 * the repo's `.bos/` (gitignored) rather than the OS tmpdir because step
 * scripts spawn `pnpm exec tsx`, which resolves the binary by walking up from
 * the cwd — only in-repo cwds find it.
 */

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export const authMigrationsSource = path.join(
  repoRoot,
  "plugins",
  "auth",
  "src",
  "db",
  "migrations",
);

const created: string[] = [];

export interface SeedSandbox {
  /** The app root — pass as the runner's `configDir`. */
  root: string;
  apiDbUrl: string;
  authDbUrl: string;
  makeWorkspace(name: string, migrations: Record<string, string>): void;
  copyAuthMigrations(): void;
}

export function createSeedSandbox(prefix: string): SeedSandbox {
  const sandboxRoot = path.join(repoRoot, ".bos", "test-sandboxes");
  mkdirSync(sandboxRoot, { recursive: true });
  const root = mkdtempSync(path.join(sandboxRoot, `${prefix}-`));
  created.push(root);
  const apiDbUrl = `pglite:${path.join(root, ".bos", "db", "api")}`;
  const authDbUrl = `pglite:${path.join(root, ".bos", "db", "auth")}`;

  const makeWorkspace = (name: string, migrations: Record<string, string>): void => {
    const wsDir = path.join(root, name);
    mkdirSync(path.join(wsDir, "src", "db"), { recursive: true });
    writeFileSync(path.join(wsDir, "package.json"), JSON.stringify({ name, type: "module" }));
    const entries = Object.keys(migrations).map((tag, idx) => ({ idx, tag }));
    writeJournal(path.join(wsDir, "src", "db", "migrations"), entries);
    for (const [tag, sqlText] of Object.entries(migrations)) {
      writeFileSync(path.join(wsDir, "src", "db", "migrations", `${tag}.sql`), sqlText);
    }
  };

  const copyAuthMigrations = (): void => {
    cpSync(authMigrationsSource, path.join(root, "auth", "src", "db", "migrations"), {
      recursive: true,
    });
  };

  return { root, apiDbUrl, authDbUrl, makeWorkspace, copyAuthMigrations };
}

export function disposeSeedSandboxes(): void {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true });
  }
  created.length = 0;
}

function writeJournal(dir: string, entries: Array<{ idx: number; tag: string }>): void {
  mkdirSync(path.join(dir, "meta"), { recursive: true });
  writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: entries.map((entry) => ({
        ...entry,
        version: "7",
        when: 1_700_000_000_000 + entry.idx,
        breakpoints: true,
      })),
    }),
  );
}

export async function rows(url: string, query: string): Promise<Array<Record<string, unknown>>> {
  const driver = await createDatabaseDriver(url, {});
  try {
    const result = (await driver.db.execute(sql.raw(query))) as unknown;
    if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
    const inner = (result as { rows?: unknown[] }).rows;
    return Array.isArray(inner) ? (inner as Array<Record<string, unknown>>) : [];
  } finally {
    await driver.close();
  }
}

export const scalar = async (url: string, query: string): Promise<number> =>
  Number((await rows(url, query))[0]?.count ?? 0);

/** The runner spawns `pnpm exec tsx` — a clear failure here says why. */
export function assertTsxAvailable(): void {
  const probe = spawnSync("pnpm", ["exec", "tsx", "--version"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    throw new Error("tsx does not resolve from the repo root — seed steps cannot spawn");
  }
}

export function authMigrationsFixtureExists(): boolean {
  return existsSync(path.join(authMigrationsSource, "meta", "_journal.json"));
}
