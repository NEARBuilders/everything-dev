import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configInputToDescriptor, toConfigInput } from "../../src/descriptor/resolve";
import { AppDescriptorSchema } from "../../src/descriptor/schema";
import { mergeBosConfigWithExtends, stripSeedConfig } from "../../src/services/resolution/merge";
import {
  ownerEmailForAccount,
  resolveOwnerCredential,
  resolveSeedWorkspaces,
  runSeedPhase,
  SEED_MARKER_TABLE,
} from "../../src/services/seed/runner";
import { BosConfigSchema } from "../../src/types";
import {
  createSeedSandbox,
  disposeSeedSandboxes,
  repoRoot,
  type SeedSandbox,
  scalar,
} from "../helpers/seed-sandbox";

/**
 * The seed block's config contract and the phase's fast bookkeeping (#865):
 * the authored descriptor accepts the block, both conversion directions
 * round-trip it, extends deep-merges it (child steps REPLACE), publish
 * canonicalization strips it, and the marker gates the phase — a seeded boot
 * pays one api-database open and skips every other workspace (and every
 * migration). The slow surfaces (auth-schema provisioning, tsx step spawns)
 * live in tests/integration/seed-phase.test.ts.
 */

const seedBlock = {
  version: 2,
  auth: { ownerAdmin: { nearAccount: "owner.test.near" } },
  steps: ["api/scripts/seed-places.ts", "api/scripts/backfill-node-places.ts"],
};

describe("seed config surface", () => {
  it("the authored descriptor parses a seed block (strict schema)", () => {
    const descriptor = AppDescriptorSchema.parse({
      name: "child.app",
      seed: seedBlock,
    });
    expect(descriptor.seed).toEqual(seedBlock);
    expect(() =>
      AppDescriptorSchema.parse({ name: "child.app", seed: { version: 1, unknown: true } }),
    ).toThrow();
    expect(() =>
      AppDescriptorSchema.parse({ name: "child.app", seed: { version: 0, steps: [] } }),
    ).toThrow();
  });

  it("descriptor → config input → descriptor round-trips the seed block", () => {
    const descriptor = AppDescriptorSchema.parse({ name: "child.app", seed: seedBlock });
    const input = toConfigInput(descriptor);
    expect(input.seed).toEqual(seedBlock);
    const back = configInputToDescriptor(input);
    expect(back.seed).toEqual(seedBlock);
  });

  it("the resolved-config parse keeps seed (BosConfigSchema is not lossless-ignorant)", () => {
    const config = BosConfigSchema.parse({
      account: "a.near",
      seed: seedBlock,
      app: {
        host: { development: "local:host", production: "https://host.example" },
        ui: { development: "local:ui", production: "https://ui.example" },
        api: { development: "local:api", production: "https://api.example" },
      },
    });
    expect(config.seed).toEqual(seedBlock);
  });

  it("extends deep-merges the seed block; child steps REPLACE the parent's", () => {
    const parent = {
      account: "parent.near",
      seed: {
        version: 1,
        auth: { ownerAdmin: true },
        steps: ["parent/scripts/parent-seed.ts"],
      },
    };
    const child = {
      account: "child.near",
      seed: {
        version: 3,
        auth: { ownerAdmin: { nearAccount: "child-owner.near" } },
        steps: ["api/scripts/child-seed.ts"],
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    expect(merged.seed).toEqual(child.seed);
  });

  it("a parent seed survives a child that declares no seed of its own", () => {
    const parent = {
      account: "parent.near",
      seed: { version: 1, steps: ["api/scripts/parent-seed.ts"] },
    };
    const merged = mergeBosConfigWithExtends(parent, { account: "child.near" });
    expect(merged.seed).toEqual(parent.seed);
  });

  it("publish canonicalization strips the seed block", () => {
    const published = stripSeedConfig({
      account: "a.near",
      seed: seedBlock,
      title: "App",
    });
    expect("seed" in published ? published.seed : undefined).toBeUndefined();
    expect(published.title).toBe("App");
    // absent seed is a no-op — rollback payloads republish verbatim
    expect(stripSeedConfig({ account: "a.near" })).toEqual({ account: "a.near" });
  });
});

describe("resolveSeedWorkspaces", () => {
  let sandbox: SeedSandbox;

  beforeEach(() => {
    sandbox = createSeedSandbox("unit-ws");
  });

  afterEach(disposeSeedSandboxes);

  it("orders auth first, api second, plugins after — the owner bootstrap's dependency order", () => {
    const workspaces = resolveSeedWorkspaces(
      {
        api: { localPath: "api" },
        auth: { localPath: "auth" },
        plugins: { votes: { localPath: "plugins/votes" } },
        networkId: "testnet",
      },
      sandbox.root,
      {},
    );
    expect(workspaces.map((ws) => ws.key)).toEqual(["auth", "api", "votes"]);
  });

  it("skips remote entries with no declared secret — nothing to address", () => {
    const workspaces = resolveSeedWorkspaces(
      { api: { localPath: "api" }, auth: null, plugins: { remoteOnly: {} } },
      sandbox.root,
      {},
    );
    expect(workspaces.map((ws) => ws.key)).toEqual(["api"]);
  });
});

describe("runSeedPhase — marker lifecycle", () => {
  let sandbox: SeedSandbox;

  beforeEach(() => {
    sandbox = createSeedSandbox("unit-marker");
    sandbox.makeWorkspace("api", {
      "0000_places": `CREATE TABLE IF NOT EXISTS "places" ("id" text PRIMARY KEY, "name" text NOT NULL);`,
    });
  });

  afterEach(disposeSeedSandboxes);

  const seedInput = (overrides: Partial<Parameters<typeof runSeedPhase>[0]> = {}) => ({
    configDir: sandbox.root,
    seed: { version: 1, steps: [] },
    runtime: { api: { localPath: "api" }, networkId: "testnet" as const },
    env: { API_DATABASE_URL: sandbox.apiDbUrl },
    ...overrides,
  });

  it("a fresh environment seeds; the second run short-circuits; a version bump re-runs", async () => {
    const first = await runSeedPhase(seedInput());
    expect(first.status).toBe("seeded");
    expect(first.markerWas).toBeNull();
    expect(first.workspaces).toContain("api");
    expect(
      await scalar(sandbox.apiDbUrl, `SELECT count(*) AS count FROM "${SEED_MARKER_TABLE}"`),
    ).toBe(1);

    // A seeded boot pays only the marker read: no workspace migrations report.
    const second = await runSeedPhase(seedInput());
    expect(second.status).toBe("already-seeded");
    expect(second.workspaces).toEqual([]);
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
    expect(forced.workspaces).toContain("api");
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

describe("repoRoot sanity", () => {
  it("the helper resolved the repo root, not a subdirectory", () => {
    expect(repoRoot.split("/").pop()).toBe("everything.dev");
  });
});
