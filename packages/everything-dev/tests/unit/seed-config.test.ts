import { describe, expect, it } from "vitest";
import { configInputToDescriptor, toConfigInput } from "../../src/descriptor/resolve";
import { AppDescriptorSchema } from "../../src/descriptor/schema";
import { mergeBosConfigWithExtends, stripSeedConfig } from "../../src/services/resolution/merge";
import { BosConfigSchema } from "../../src/types";

/**
 * The seed block's config contract (#865): the authored descriptor accepts
 * it, both conversion directions round-trip it, extends deep-merges it
 * (child steps REPLACE — a child declares its own pipeline, it does not
 * inherit the parent's scripts), the resolved config parse keeps it, and
 * publish canonicalization strips it (workspace-relative steps and dev
 * owner identities never reach FastKV).
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
