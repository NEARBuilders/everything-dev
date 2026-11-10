import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { resolveDatabaseUrl } from "../../db/binding";
import { getMigrationStorage, pluginMigrationSlug } from "../../db/core";
import { createDatabaseDriver, pluginSchemaName } from "../../db/driver";
import type { WorkspaceIdentity } from "../../db/identity";
import { workspaceIdentityFromWorkspaceDir } from "../../db/identity";
import { loadMigrations, runMigrations } from "../../db/run-migrations";
import type { SeedConfig, SeedOwnerAdmin } from "../../types";

/**
 * The seed phase (#865): run the app's declared seed before services serve.
 *
 * Ordering is forced by the database topology. In dev every workspace DB is a
 * PGlite data dir held open by its service process for the process's lifetime
 * (ADR 0044) — cross-process opens block on the file lock — so nothing here
 * may run while services are up. The phase therefore runs pre-spawn, which
 * also means it must ensure the schema itself: a fresh checkout has no tables
 * until the services' in-process migrate-on-boot fires, and this phase runs
 * before it. `loadMigrations` + `runMigrations` replay each local workspace's
 * migrations against the same per-workspace journal the services use (ADR
 * 0045), so the later in-process run converges to a no-op.
 *
 * Steps are the general surface — arbitrary idempotent scripts (upserts by
 * contract) against any workspace DB, run once per `seed.version`. The marker
 * (one `bos_seed_state` row in the api database) records the version that
 * produced the current state; a matching version short-circuits the whole
 * phase, a bump re-runs it deliberately.
 *
 * The owner-admin bootstrap is framework-provided and always first: direct
 * writes into the auth database in exactly the row shape the SIWN flow
 * expects (`user` + `near_account` + `account`), so the configured owner
 * signs in with platform-admin rights immediately — `/near/verify` finds the
 * pre-provisioned `near_account` row and hands out a session for the admin
 * user instead of creating a second user. The row shapes couple this module
 * to the auth plugin's schema; both ship in release lockstep from this repo,
 * and a missing `near_account` table (schema drift) fails loudly before any
 * write.
 */

export const SEED_MARKER_TABLE = "bos_seed_state";
const SEED_MARKER_ID = "app";

type SeedDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export class SeedPhaseError extends Error {
  constructor(
    message: string,
    readonly stage: string,
    readonly step?: string,
  ) {
    super(message);
    this.name = "SeedPhaseError";
  }
}

export interface SeedOwnerCredential {
  nearAccount?: string;
  email?: string;
}

/** The runtime slice the phase needs — a full `RuntimeConfig` satisfies it. */
export interface SeedRuntimeShape {
  api?: { localPath?: string } | null;
  auth?: { localPath?: string } | null;
  plugins?: Record<string, { localPath?: string }> | null;
  networkId?: "mainnet" | "testnet";
}

export interface SeedPhaseInput {
  /** The app root (repo root) — step paths resolve against it. */
  configDir: string;
  seed: SeedConfig;
  /** The resolved runtime — local workspace paths and the active network. */
  runtime: SeedRuntimeShape;
  /** Top-level `account` — the owner identity behind `ownerAdmin: true`. */
  fallbackAccount?: string;
  /** The siwn recipient for synthetic owner emails. */
  siwnRecipient?: string;
  /** The merged operator environment (already-loaded `.env` included). */
  env: Record<string, string | undefined>;
  /**
   * Production credentials — env-provided, never config defaults. When set,
   * they replace the authored owner identity entirely.
   */
  ownerOverride?: SeedOwnerCredential;
  /** Re-run owner + steps even when the marker version matches. */
  force?: boolean;
}

export interface SeedStepOutcome {
  step: string;
  status: "ran" | "failed";
  error?: string;
}

export interface SeedOwnerOutcome {
  mode: "near" | "email";
  provisioned: boolean;
  accountId: string;
}

export interface SeedPhaseResult {
  status: "seeded" | "already-seeded";
  version: number;
  markerWas: number | null;
  workspaces: string[];
  owner: SeedOwnerOutcome | null;
  steps: SeedStepOutcome[];
}

interface SeedWorkspace {
  key: string;
  slug: string;
  workspaceDir: string | undefined;
  identity: WorkspaceIdentity;
  url: string;
  schemaName: string | undefined;
  hasMigrations: boolean;
}

interface RuntimeEntry {
  localPath?: string;
}

const migrationsJournalPath = (workspaceDir: string): string =>
  join(workspaceDir, "src", "db", "migrations", "meta", "_journal.json");

const secretNameForSlug = (slug: string): string =>
  `${slug.toUpperCase().replace(/-/g, "_")}_DATABASE_URL`;

/**
 * The workspaces the phase touches, in dependency order: auth first (the
 * owner bootstrap writes there), then the api shell (the marker's home),
 * then every local plugin. Remote entries resolve to their secret name with
 * no local dir — migrations are skipped for them (nothing to load) but the
 * binding still addresses the right database.
 */
export function resolveSeedWorkspaces(
  runtime: SeedRuntimeShape,
  configDir: string,
  env: Record<string, string | undefined>,
): SeedWorkspace[] {
  const entries: Array<{ key: string; entry: RuntimeEntry | undefined; plugin: boolean }> = [
    { key: "auth", entry: (runtime.auth ?? undefined) as RuntimeEntry | undefined, plugin: false },
    { key: "api", entry: (runtime.api ?? undefined) as RuntimeEntry | undefined, plugin: false },
    ...Object.keys(runtime.plugins ?? {})
      .sort()
      .map((key) => ({
        key,
        entry: runtime.plugins?.[key] as RuntimeEntry | undefined,
        plugin: true,
      })),
  ];

  const workspaces: SeedWorkspace[] = [];
  for (const { key, entry, plugin } of entries) {
    if (!entry) continue;
    const slug = pluginMigrationSlug(key);
    const workspaceDir = entry.localPath ? resolve(configDir, entry.localPath) : undefined;
    const identity = workspaceDir
      ? workspaceIdentityFromWorkspaceDir(workspaceDir)
      : {
          slug,
          secretName: secretNameForSlug(slug),
          journal: getMigrationStorage(slug),
          workspaceDir: undefined,
        };
    const hasMigrations =
      workspaceDir !== undefined && existsSync(migrationsJournalPath(workspaceDir));
    if (!hasMigrations && workspaceDir === undefined && !env[identity.secretName]) {
      continue;
    }
    workspaces.push({
      key,
      slug: identity.slug,
      workspaceDir,
      identity,
      url: resolveDatabaseUrl(identity, { env }),
      schemaName: plugin ? pluginSchemaName(identity.slug) : undefined,
      hasMigrations,
    });
  }
  return workspaces;
}

/** Sequential open → use → close — the phase holds no driver across steps. */
async function withWorkspaceDb<T>(ws: SeedWorkspace, run: (db: SeedDb) => Promise<T>): Promise<T> {
  const driver = await createDatabaseDriver<Record<string, unknown>>(
    ws.url,
    {},
    ws.schemaName,
    `${ws.identity.journal.schema}.${ws.identity.journal.table}`,
  );
  try {
    return await run(driver.db);
  } finally {
    await driver.close();
  }
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

async function ensureMarkerTable(db: SeedDb): Promise<void> {
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "${SEED_MARKER_TABLE}" (` +
        "id text PRIMARY KEY, " +
        "version integer NOT NULL, " +
        "seeded_at timestamptz NOT NULL DEFAULT now(), " +
        "steps jsonb)",
    ),
  );
}

async function readSeedMarker(api: SeedWorkspace): Promise<number | null> {
  return withWorkspaceDb(api, async (db) => {
    await ensureMarkerTable(db);
    const result = await db.execute(
      sql`SELECT version FROM ${sql.identifier(SEED_MARKER_TABLE)} WHERE id = ${SEED_MARKER_ID}`,
    );
    const row = rowsOf(result)[0];
    return typeof row?.version === "number" ? row.version : null;
  });
}

async function writeSeedMarker(
  api: SeedWorkspace,
  version: number,
  steps: string[],
): Promise<void> {
  await withWorkspaceDb(api, async (db) => {
    await ensureMarkerTable(db);
    await db.execute(
      sql`INSERT INTO ${sql.identifier(SEED_MARKER_TABLE)} (id, version, steps)
          VALUES (${SEED_MARKER_ID}, ${version}, ${JSON.stringify(steps)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET version = ${version}, seeded_at = now(), steps = ${JSON.stringify(steps)}::jsonb`,
    );
  });
}

/** Replay each local workspace's migrations against its own journal. */
async function ensureWorkspaceSchemas(workspaces: SeedWorkspace[]): Promise<string[]> {
  const migrated: string[] = [];
  for (const ws of workspaces) {
    if (!ws.hasMigrations || !ws.workspaceDir) continue;
    const loaded = await Effect.runPromise(
      loadMigrations({ fromDir: join(ws.workspaceDir, "src", "db") }),
    ).catch((cause: unknown) => {
      throw new SeedPhaseError(
        `loading migrations for "${ws.key}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        "migrate",
      );
    });
    if (loaded.migrations.length === 0) continue;
    await withWorkspaceDb(ws, (db) =>
      Effect.runPromise(
        runMigrations(db, loaded.migrations, {
          journal: ws.identity.journal,
          schemaName: ws.schemaName,
        }),
      ).catch((cause: unknown) => {
        throw new SeedPhaseError(
          `migrating "${ws.key}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          "migrate",
        );
      }),
    );
    migrated.push(ws.slug);
  }
  return migrated;
}

/**
 * Mirror better-near-auth's `deriveEmail` with a deterministic tail: the
 * single-segment `.near` shape the SIWN flow derives, or the recognized
 * `temp-<hex>@<recipient>` synthetic form (stable hash — re-runs must not
 * mint a second identity).
 */
export function ownerEmailForAccount(accountId: string, recipient: string): string {
  if (accountId.endsWith(".near")) {
    const localPart = accountId.slice(0, -5);
    if (!localPart.includes(".")) return `${localPart}@near.email`;
  }
  const hash = createHash("sha256").update(accountId).digest("hex").slice(0, 8);
  return `temp-${hash}@${recipient}`;
}

export function resolveOwnerCredential(
  ownerAdmin: SeedOwnerAdmin | undefined,
  fallbackAccount: string | undefined,
  override: SeedOwnerCredential | undefined,
): SeedOwnerCredential | null {
  if (override) {
    if (!override.nearAccount && !override.email) return null;
    return override;
  }
  if (!ownerAdmin) return null;
  if (ownerAdmin === true) {
    return fallbackAccount ? { nearAccount: fallbackAccount } : null;
  }
  const credential: SeedOwnerCredential = {};
  if (ownerAdmin.nearAccount) credential.nearAccount = ownerAdmin.nearAccount;
  if (ownerAdmin.email) credential.email = ownerAdmin.email;
  return credential.nearAccount || credential.email ? credential : null;
}

const findUserIdByNearAccount = async (db: SeedDb, accountId: string): Promise<string | null> => {
  const result = await db.execute(
    sql`SELECT u.id FROM "user" u JOIN near_account na ON na.user_id = u.id WHERE na.account_id = ${accountId} LIMIT 1`,
  );
  const row = rowsOf(result)[0];
  return typeof row?.id === "string" ? row.id : null;
};

const findUserIdByEmail = async (db: SeedDb, email: string): Promise<string | null> => {
  const result = await db.execute(sql`SELECT id FROM "user" WHERE email = ${email} LIMIT 1`);
  const row = rowsOf(result)[0];
  return typeof row?.id === "string" ? row.id : null;
};

const promoteToAdmin = async (db: SeedDb, userId: string): Promise<void> => {
  await db.execute(sql`UPDATE "user" SET role = 'admin', updated_at = now() WHERE id = ${userId}`);
};

/**
 * Provision the owner as platform admin (`user.role = 'admin'`) in the auth
 * database. NEAR owners get the full SIWN row shape — `user`, `near_account`
 * (unique on `(account_id, network)`, which is exactly what `/near/verify`
 * resolves first), and the `account` provider row — so first sign-in finds
 * the admin user instead of minting a duplicate.
 */
export async function provisionOwnerAdmin(
  auth: SeedWorkspace,
  credential: SeedOwnerCredential,
  options: { networkId?: string; recipient?: string },
): Promise<SeedOwnerOutcome> {
  return withWorkspaceDb(auth, async (db) => {
    const nearTable = await db.execute(sql`SELECT to_regclass('public.near_account') AS reg`);
    const reg = rowsOf(nearTable)[0]?.reg;
    if (!reg) {
      throw new SeedPhaseError(
        "the auth database has no near_account table — the auth plugin schema is missing or from an incompatible version; run `bos db doctor auth`",
        "owner",
      );
    }

    const networkId = options.networkId ?? "mainnet";
    const recipient = options.recipient ?? "seed.internal";

    const ensureAdmin = async (userId: string): Promise<void> => {
      const current = await db.execute(sql`SELECT role FROM "user" WHERE id = ${userId}`);
      const role = rowsOf(current)[0]?.role;
      if (role !== "admin") await promoteToAdmin(db, userId);
    };

    if (credential.nearAccount) {
      const accountId = credential.nearAccount;
      const existing =
        (await findUserIdByNearAccount(db, accountId)) ??
        (await findUserIdByEmail(db, ownerEmailForAccount(accountId, recipient)));
      if (existing) {
        await ensureAdmin(existing);
        return { mode: "near", provisioned: true, accountId: existing };
      }

      const userId = randomUUID();
      const email = ownerEmailForAccount(accountId, recipient);
      await db.execute(
        sql`INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
            VALUES (${userId}, ${accountId}, ${email}, true, 'admin', now(), now())`,
      );
      await db.execute(
        sql`INSERT INTO near_account (id, user_id, account_id, network, public_key, is_primary, created_at)
            VALUES (${randomUUID()}, ${userId}, ${accountId}, ${networkId}, 'seed:pending', true, now())`,
      );
      const providerAccountId = `${accountId}:${networkId}`;
      const providerExists = rowsOf(
        await db.execute(
          sql`SELECT id FROM "account" WHERE provider_id = 'siwn' AND account_id = ${providerAccountId} LIMIT 1`,
        ),
      )[0];
      if (!providerExists) {
        await db.execute(
          sql`INSERT INTO "account" (id, account_id, provider_id, user_id, created_at, updated_at)
              VALUES (${randomUUID()}, ${providerAccountId}, 'siwn', ${userId}, now(), now())`,
        );
      }
      return { mode: "near", provisioned: true, accountId: userId };
    }

    const email = credential.email!;
    const existing = await findUserIdByEmail(db, email);
    if (existing) {
      await ensureAdmin(existing);
      return { mode: "email", provisioned: true, accountId: existing };
    }
    const userId = randomUUID();
    await db.execute(
      sql`INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
          VALUES (${userId}, ${email.split("@")[0]}, ${email}, true, 'admin', now(), now())`,
    );
    return { mode: "email", provisioned: true, accountId: userId };
  });
}

async function runSeedStep(
  configDir: string,
  step: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const scriptPath = resolve(configDir, step);
  if (!existsSync(scriptPath)) {
    throw new SeedPhaseError(`seed step not found: ${step}`, "steps", step);
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", scriptPath], {
      cwd: configDir,
      env: env as NodeJS.ProcessEnv,
      stdio: "inherit",
    });
    child.on("error", (cause) => {
      reject(
        new SeedPhaseError(
          `seed step "${step}" could not start (tsx must be installed at the workspace root): ${cause.message}`,
          "steps",
          step,
        ),
      );
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new SeedPhaseError(
          `seed step "${step}" exited with code ${code} — steps are idempotent by contract; fix and re-run (bump seed.version or pass --force)`,
          "steps",
          step,
        ),
      );
    });
  });
}

export async function runSeedPhase(input: SeedPhaseInput): Promise<SeedPhaseResult> {
  const { seed, configDir, env, runtime } = input;
  const workspaces = resolveSeedWorkspaces(runtime, configDir, env);
  const api = workspaces.find((ws) => ws.key === "api");
  if (!api) {
    throw new SeedPhaseError(
      "no api workspace binding — the seed marker lives in the api database",
      "marker",
    );
  }
  const auth = workspaces.find((ws) => ws.key === "auth");

  const migrated = await ensureWorkspaceSchemas(workspaces);

  const markerWas = await readSeedMarker(api);
  const declaredSteps = seed.steps ?? [];
  if (!input.force && markerWas === seed.version) {
    return {
      status: "already-seeded",
      version: seed.version,
      markerWas,
      workspaces: migrated,
      owner: null,
      steps: [],
    };
  }

  const credential = resolveOwnerCredential(
    seed.auth?.ownerAdmin,
    input.fallbackAccount,
    input.ownerOverride,
  );
  let owner: SeedOwnerOutcome | null = null;
  if (credential) {
    if (!auth) {
      throw new SeedPhaseError(
        "seed.auth.ownerAdmin is declared but the app has no auth slot to provision into",
        "owner",
      );
    }
    owner = await provisionOwnerAdmin(auth, credential, {
      networkId: runtime.networkId,
      recipient: input.siwnRecipient,
    });
  }

  const stepEnv: Record<string, string | undefined> = { ...process.env, ...env };
  for (const ws of workspaces) {
    if (!stepEnv[ws.identity.secretName]) {
      stepEnv[ws.identity.secretName] = ws.url;
    }
  }

  const outcomes: SeedStepOutcome[] = [];
  for (const step of declaredSteps) {
    try {
      await runSeedStep(configDir, step, stepEnv);
      outcomes.push({ step, status: "ran" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({ step, status: "failed", error: message });
      throw error;
    }
  }

  await writeSeedMarker(api, seed.version, declaredSteps);

  return {
    status: "seeded",
    version: seed.version,
    markerWas,
    workspaces: migrated,
    owner,
    steps: outcomes,
  };
}
