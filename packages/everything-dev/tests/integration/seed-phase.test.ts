import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseDriver } from "../../src/db/driver";
import {
  provisionOwnerAdmin,
  runSeedPhase,
  SEED_MARKER_TABLE,
} from "../../src/services/seed/runner";
import {
  assertTsxAvailable,
  authMigrationsFixtureExists,
  createSeedSandbox,
  disposeSeedSandboxes,
  repoRoot,
  rows,
  type SeedSandbox,
  scalar,
} from "../helpers/seed-sandbox";

/**
 * The seed phase's slow surfaces (#865): the owner-admin bootstrap against the
 * REAL auth plugin migrations (the schema-coupling canary — an auth schema
 * change that breaks provisioning turns this red), tsx step spawns, and the
 * live-stack guard. The fast bookkeeping (config surface, marker gate) lives
 * in tests/unit/seed-phase.test.ts.
 */

const mocks = vi.hoisted(() => ({
  registry: [] as Array<{ pid: number; configDir: string; role: string }>,
}));

vi.mock("../../src/services/processes/registry", () => ({
  readRegistry: () => mocks.registry,
  pruneDead: (entries: unknown[]) => entries,
}));

let sandbox: SeedSandbox;
let apiDbUrl: string;
let authDbUrl: string;

const ownerSeed = {
  version: 1,
  auth: { ownerAdmin: { nearAccount: "owner.near" } },
  steps: [],
};

function seedInput(overrides: Partial<Parameters<typeof runSeedPhase>[0]> = {}) {
  return {
    configDir: sandbox.root,
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
  sandbox = createSeedSandbox("int-seed");
  apiDbUrl = sandbox.apiDbUrl;
  authDbUrl = sandbox.authDbUrl;
  sandbox.makeWorkspace("api", {
    "0000_places": `CREATE TABLE IF NOT EXISTS "places" ("id" text PRIMARY KEY, "name" text NOT NULL);`,
  });
  sandbox.makeWorkspace("auth", {});
  sandbox.copyAuthMigrations();
  mocks.registry = [];
});

afterEach(disposeSeedSandboxes);

describe("runSeedPhase — owner admin bootstrap", () => {
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
    const brokenAuthUrl = `pglite:${path.join(sandbox.root, ".bos", "db", "auth-broken")}`;
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
    const logFile = path.join(sandbox.root, "steps.log");
    const stepScript = [
      `import { appendFileSync } from "node:fs";`,
      `appendFileSync(${JSON.stringify(logFile)}, String(process.env.API_DATABASE_URL?.startsWith("pglite:")) + "\\n");`,
    ].join("\n");
    mkdirSync(path.join(sandbox.root, "api", "scripts"), { recursive: true });
    writeFileSync(path.join(sandbox.root, "api", "scripts", "one.ts"), stepScript);
    writeFileSync(path.join(sandbox.root, "api", "scripts", "two.ts"), stepScript);

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
    mkdirSync(path.join(sandbox.root, "api", "scripts"), { recursive: true });
    writeFileSync(path.join(sandbox.root, "api", "scripts", "boom.ts"), "process.exit(3);");
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

  it("SEED_STEP_TIMEOUT_MS aborts a hung step", async () => {
    mkdirSync(path.join(sandbox.root, "api", "scripts"), { recursive: true });
    writeFileSync(
      path.join(sandbox.root, "api", "scripts", "hangs.ts"),
      "setInterval(() => {}, 60_000);",
    );
    await expect(
      runSeedPhase(
        seedInput({
          seed: { version: 1, steps: ["api/scripts/hangs.ts"] },
          env: {
            API_DATABASE_URL: apiDbUrl,
            AUTH_DATABASE_URL: authDbUrl,
            SEED_STEP_TIMEOUT_MS: "400",
          },
        }),
      ),
    ).rejects.toThrow(/timed out after 400ms/);
    expect(await scalar(apiDbUrl, `SELECT count(*) AS count FROM "${SEED_MARKER_TABLE}"`)).toBe(0);
  }, 20_000);
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

describe("guardAgainstLiveStack", () => {
  it("refuses to seed when the pid registry shows a live stack for this project", async () => {
    mocks.registry = [{ pid: 424242, configDir: sandbox.root, role: "standalone" }];
    await expect(runSeedPhase(seedInput())).rejects.toThrow(/dev stack.*bos kill/s);
    expect(
      await rows(apiDbUrl, `SELECT to_regclass('public."${SEED_MARKER_TABLE}"') AS reg`),
    ).toEqual([{ reg: null }]);
  });

  it("proceeds when the registry is empty or points elsewhere", async () => {
    mocks.registry = [
      { pid: 424242, configDir: path.join(repoRoot, "elsewhere"), role: "standalone" },
    ];
    const result = await runSeedPhase(seedInput());
    expect(result.status).toBe("seeded");
  });
});

describe("fixtures", () => {
  it("tsx resolves from the repo root (the runner spawns `pnpm exec tsx`)", () => {
    expect(() => assertTsxAvailable()).not.toThrow();
  });

  it("the auth migrations fixture exists (copied into each sandbox)", () => {
    expect(authMigrationsFixtureExists()).toBe(true);
  });
});
