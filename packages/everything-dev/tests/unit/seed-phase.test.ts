import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseDriver } from "../../src/db/driver";
import {
  ownerEmailForAccount,
  provisionOwnerAdmin,
  resolveOwnerCredential,
  resolveSeedWorkspaces,
  runSeedPhase,
  SEED_MARKER_TABLE,
} from "../../src/services/seed/runner";

/**
 * The seed phase's contract (#865): a fresh environment migrates the local
 * workspaces, provisions the owner admin first, runs the declared steps, and
 * writes a marker; the next run short-circuits; a version bump re-runs. The
 * owner rows must match the SIWN flow's lookup shape — `/near/verify` finds
 * the pre-provisioned `near_account` and issues a session for the admin user
 * instead of minting a duplicate.
 *
 * Sandboxes live under the repo's `.bos/` (gitignored) rather than the OS
 * tmpdir because step scripts spawn `pnpm exec tsx`, which resolves the
 * binary by walking up from the cwd — only in-repo cwds find it.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const authMigrationsSource = path.join(repoRoot, "plugins", "auth", "src", "db", "migrations");

let sandbox: string;
let apiDbUrl: string;
let authDbUrl: string;

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

function makeWorkspace(name: string, migrations: Record<string, string>): void {
  const wsDir = path.join(sandbox, name);
  mkdirSync(path.join(wsDir, "src", "db"), { recursive: true });
  writeFileSync(path.join(wsDir, "package.json"), JSON.stringify({ name, type: "module" }));
  const entries = Object.keys(migrations).map((tag, idx) => ({ idx, tag }));
  writeJournal(path.join(wsDir, "src", "db", "migrations"), entries);
  for (const [tag, sqlText] of Object.entries(migrations)) {
    writeFileSync(path.join(wsDir, "src", "db", "migrations", `${tag}.sql`), sqlText);
  }
}

async function rows(url: string, query: string): Promise<Array<Record<string, unknown>>> {
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

const scalar = async (url: string, query: string): Promise<number> =>
  Number((await rows(url, query))[0]?.count ?? 0);

function seedInput(overrides: Partial<Parameters<typeof runSeedPhase>[0]> = {}) {
  return {
    configDir: sandbox,
    seed: { version: 1, steps: [] },
    runtime: {
      api: { localPath: "api" },
      auth: { localPath: "auth" },
      networkId: "testnet" as const,
    },
    fallbackAccount: "owner.near",
    siwnRecipient: "app.test.near",
    env: {
      API_DATABASE_URL: apiDbUrl,
      AUTH_DATABASE_URL: authDbUrl,
    },
    ...overrides,
  };
}

beforeEach(() => {
  const sandboxRoot = path.join(repoRoot, ".bos", "test-sandboxes");
  mkdirSync(sandboxRoot, { recursive: true });
  sandbox = mkdtempSync(path.join(sandboxRoot, `seed-${process.pid}-`));
  apiDbUrl = `pglite:${path.join(sandbox, ".bos", "db", "api")}`;
  authDbUrl = `pglite:${path.join(sandbox, ".bos", "db", "auth")}`;

  makeWorkspace("api", {
    "0000_places": `CREATE TABLE IF NOT EXISTS "places" ("id" text PRIMARY KEY, "name" text NOT NULL);`,
  });
  makeWorkspace("auth", {});
  cpSync(authMigrationsSource, path.join(sandbox, "auth", "src", "db", "migrations"), {
    recursive: true,
  });
});

afterEach(() => {
  rmSync(path.join(repoRoot, ".bos", "test-sandboxes"), {
    recursive: true,
    force: true,
  });
});

describe("resolveSeedWorkspaces", () => {
  it("orders auth first, api second, plugins after — the owner bootstrap's dependency order", () => {
    const workspaces = resolveSeedWorkspaces(
      {
        api: { localPath: "api" },
        auth: { localPath: "auth" },
        plugins: { votes: { localPath: "plugins/votes" } },
        networkId: "testnet",
      },
      sandbox,
      {},
    );
    expect(workspaces.map((ws) => ws.key)).toEqual(["auth", "api", "votes"]);
  });

  it("skips remote entries with no declared secret — nothing to address", () => {
    const workspaces = resolveSeedWorkspaces(
      { api: { localPath: "api" }, auth: null, plugins: { remoteOnly: {} } },
      sandbox,
      {},
    );
    expect(workspaces.map((ws) => ws.key)).toEqual(["api"]);
  });
});

describe("runSeedPhase — marker lifecycle", () => {
  it("a fresh environment seeds; the second run short-circuits; a version bump re-runs", async () => {
    const first = await runSeedPhase(seedInput());
    expect(first.status).toBe("seeded");
    expect(first.markerWas).toBeNull();
    expect(await scalar(apiDbUrl, `SELECT count(*) AS count FROM "${SEED_MARKER_TABLE}"`)).toBe(1);

    const second = await runSeedPhase(seedInput());
    expect(second.status).toBe("already-seeded");
    expect(second.owner).toBeNull();
    expect(second.steps).toEqual([]);

    const bumped = await runSeedPhase(seedInput({ seed: { version: 2, steps: [] } }));
    expect(bumped.status).toBe("seeded");
    expect(bumped.markerWas).toBe(1);
  });

  it("--force re-runs the phase even when the marker version matches", async () => {
    await runSeedPhase(seedInput());
    const forced = await runSeedPhase(seedInput({ force: true }));
    expect(forced.status).toBe("seeded");
  });
});

describe("runSeedPhase — owner admin bootstrap", () => {
  const ownerSeed = {
    version: 1,
    auth: { ownerAdmin: { nearAccount: "owner.near" } },
    steps: [],
  };

  it("provisions a NEAR owner with the full SIWN row shape; /near/verify's lookup finds the admin", async () => {
    const result = await runSeedPhase(seedInput({ seed: ownerSeed }));
    expect(result.owner).toEqual({
      mode: "near",
      provisioned: true,
      accountId: expect.any(String),
    });

    const users = await rows(
      authDbUrl,
      `SELECT id, email, role, email_verified FROM "user" WHERE name = 'owner.near'`,
    );
    expect(users).toHaveLength(1);
    const [user] = users;
    expect(user.role).toBe("admin");
    expect(user.email).toBe("owner@near.email");
    expect(user.email_verified).toBe(true);
    const userId = String(user.id);

    expect(
      await rows(
        authDbUrl,
        `SELECT account_id, network, is_primary FROM near_account WHERE user_id = '${userId}'`,
      ),
    ).toEqual([{ account_id: "owner.near", network: "testnet", is_primary: true }]);

    expect(
      await rows(
        authDbUrl,
        `SELECT provider_id, account_id FROM "account" WHERE user_id = '${userId}'`,
      ),
    ).toEqual([{ provider_id: "siwn", account_id: "owner.near:testnet" }]);
  });

  it("is idempotent — re-provisioning (force) neither duplicates users nor re-links accounts", async () => {
    await runSeedPhase(seedInput({ seed: ownerSeed }));
    await runSeedPhase(seedInput({ seed: ownerSeed, force: true }));

    expect(
      await scalar(authDbUrl, `SELECT count(*) AS count FROM "user" WHERE name = 'owner.near'`),
    ).toBe(1);
    expect(
      await scalar(
        authDbUrl,
        `SELECT count(*) AS count FROM near_account WHERE account_id = 'owner.near'`,
      ),
    ).toBe(1);
    expect(
      await scalar(
        authDbUrl,
        `SELECT count(*) AS count FROM "account" WHERE provider_id = 'siwn' AND account_id = 'owner.near:testnet'`,
      ),
    ).toBe(1);
  });

  it("promotes an existing user found by email instead of creating a second one", async () => {
    await runSeedPhase(seedInput({ seed: { version: 1, steps: [] } }));

    const driver = await createDatabaseDriver(authDbUrl, {});
    try {
      await driver.db.execute(
        sql`INSERT INTO "user" (id, name, email, role, created_at, updated_at) VALUES ('existing-user', 'Existing', 'owner@near.email', 'user', now(), now())`,
      );
    } finally {
      await driver.close();
    }

    await runSeedPhase(
      seedInput({
        seed: { version: 2, auth: { ownerAdmin: { nearAccount: "owner.near" } }, steps: [] },
      }),
    );

    expect(
      await rows(authDbUrl, `SELECT id, role FROM "user" WHERE email = 'owner@near.email'`),
    ).toEqual([{ id: "existing-user", role: "admin" }]);
    expect(
      await scalar(authDbUrl, `SELECT count(*) AS count FROM "user" WHERE name = 'owner.near'`),
    ).toBe(0);
  });

  it("multi-segment accounts get the deterministic temp- synthetic email", async () => {
    await runSeedPhase(
      seedInput({
        seed: {
          version: 1,
          auth: { ownerAdmin: { nearAccount: "dev.everything.near" } },
          steps: [],
        },
      }),
    );
    const users = await rows(
      authDbUrl,
      `SELECT email FROM "user" WHERE name = 'dev.everything.near'`,
    );
    expect(String(users[0].email)).toMatch(/^temp-[0-9a-f]{8}@app\.test\.near$/);
  });

  it("an email owner upserts by email", async () => {
    const result = await runSeedPhase(
      seedInput({
        seed: { version: 1, auth: { ownerAdmin: { email: "owner@example.com" } }, steps: [] },
      }),
    );
    expect(result.owner).toEqual({
      mode: "email",
      provisioned: true,
      accountId: expect.any(String),
    });
    expect(
      await rows(authDbUrl, `SELECT role FROM "user" WHERE email = 'owner@example.com'`),
    ).toEqual([{ role: "admin" }]);
  });

  it("ownerOverride replaces the authored identity — production's env-only rule", async () => {
    await runSeedPhase(
      seedInput({
        seed: { version: 1, auth: { ownerAdmin: true }, steps: [] },
        ownerOverride: { nearAccount: "prod.owner.near" },
      }),
    );
    expect(await rows(authDbUrl, `SELECT name FROM "user" WHERE role = 'admin'`)).toEqual([
      { name: "prod.owner.near" },
    ]);
  });

  it("a schema-drifted auth database (no near_account) fails loudly before any write", async () => {
    const brokenAuthUrl = `pglite:${path.join(sandbox, ".bos", "db", "auth-broken")}`;
    await expect(
      provisionOwnerAdmin(
        {
          key: "auth",
          slug: "auth",
          workspaceDir: undefined,
          identity: {
            slug: "auth",
            secretName: "AUTH_DATABASE_URL",
            journal: { schema: "drizzle", table: "__drizzle_migrations_auth", slug: "auth" },
            workspaceDir: undefined,
          },
          url: brokenAuthUrl,
          schemaName: undefined,
          hasMigrations: false,
        },
        { nearAccount: "owner.near" },
        { networkId: "testnet" },
      ),
    ).rejects.toThrow(/near_account/);
    expect(await rows(brokenAuthUrl, `SELECT to_regclass('public."user"') AS reg`)).toEqual([
      { reg: null },
    ]);
  });
});

describe("runSeedPhase — steps", () => {
  it("runs declared steps in order and hands each the resolved database URLs", async () => {
    const logFile = path.join(sandbox, "steps.log");
    const stepScript = [
      `import { appendFileSync } from "node:fs";`,
      `appendFileSync(${JSON.stringify(logFile)}, String(process.env.API_DATABASE_URL?.startsWith("pglite:")) + "\\n");`,
    ].join("\n");
    mkdirSync(path.join(sandbox, "api", "scripts"), { recursive: true });
    writeFileSync(path.join(sandbox, "api", "scripts", "one.ts"), stepScript);
    writeFileSync(path.join(sandbox, "api", "scripts", "two.ts"), stepScript);

    const result = await runSeedPhase(
      seedInput({ seed: { version: 1, steps: ["api/scripts/one.ts", "api/scripts/two.ts"] } }),
    );
    expect(result.steps).toEqual([
      { step: "api/scripts/one.ts", status: "ran" },
      { step: "api/scripts/two.ts", status: "ran" },
    ]);
    expect(readFileSync(logFile, "utf8")).toBe("true\ntrue\n");
  });

  it("a failing step aborts the phase and the marker is not written", async () => {
    mkdirSync(path.join(sandbox, "api", "scripts"), { recursive: true });
    writeFileSync(path.join(sandbox, "api", "scripts", "boom.ts"), "process.exit(3);");
    await expect(
      runSeedPhase(seedInput({ seed: { version: 1, steps: ["api/scripts/boom.ts"] } })),
    ).rejects.toThrow(/boom\.ts.*code 3/);
    expect(await scalar(apiDbUrl, `SELECT count(*) AS count FROM "${SEED_MARKER_TABLE}"`)).toBe(0);
  });

  it("a missing step script fails loudly", async () => {
    await expect(
      runSeedPhase(seedInput({ seed: { version: 1, steps: ["api/scripts/nope.ts"] } })),
    ).rejects.toThrow(/not found/);
  });
});

describe("runSeedPhase — migrations", () => {
  it("the phase migrates every local workspace before steps run — a fresh api has its tables", async () => {
    const result = await runSeedPhase(seedInput({ seed: { version: 1, steps: [] } }));
    expect(result.workspaces).toEqual(expect.arrayContaining(["api", "auth"]));
    expect(await rows(apiDbUrl, `SELECT to_regclass('public.places') AS reg`)).toEqual([
      { reg: "places" },
    ]);
    // auth schema from the real plugin migrations
    expect(await rows(authDbUrl, `SELECT to_regclass('public.near_account') AS reg`)).toEqual([
      { reg: "near_account" },
    ]);
  });
});

describe("resolveOwnerCredential", () => {
  it("true derives from the top-level account; explicit objects pass through; override wins", () => {
    expect(resolveOwnerCredential(true, "acct.near", undefined)).toEqual({
      nearAccount: "acct.near",
    });
    expect(resolveOwnerCredential(undefined, "acct.near", undefined)).toBeNull();
    expect(resolveOwnerCredential(true, undefined, undefined)).toBeNull();
    expect(resolveOwnerCredential({ email: "a@b.c" }, "acct.near", undefined)).toEqual({
      email: "a@b.c",
    });
    expect(
      resolveOwnerCredential({ nearAccount: "x.near" }, "acct.near", { email: "y@z.w" }),
    ).toEqual({
      email: "y@z.w",
    });
    expect(resolveOwnerCredential(true, "acct.near", { nearAccount: "", email: "" })).toBeNull();
  });

  it("ownerEmailForAccount mirrors deriveEmail — single-segment .near to near.email, else temp- synthetic", () => {
    expect(ownerEmailForAccount("owner.near", "app.near")).toBe("owner@near.email");
    expect(ownerEmailForAccount("dev.everything.near", "app.near")).toMatch(
      /^temp-[0-9a-f]{8}@app\.near$/,
    );
    expect(ownerEmailForAccount("abc.def.near", "app.near")).toBe(
      ownerEmailForAccount("abc.def.near", "app.near"),
    );
  });
});

// The runner spawns `pnpm exec tsx` — if tsx ever leaves the root
// devDependencies, every step test would fail opaquely. This guard says why.
describe("step spawn prerequisite", () => {
  it("tsx resolves from the repo root", () => {
    const probe = spawnSync("pnpm", ["exec", "tsx", "--version"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(probe.status).toBe(0);
  });

  it("the auth migrations fixture exists (copied into each sandbox)", () => {
    expect(existsSync(path.join(authMigrationsSource, "meta", "_journal.json"))).toBe(true);
  });
});
