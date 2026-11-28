import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { regenerationRemedy } from "../../src/utils/checkout-bootstrap";

describe("regenerationRemedy (#956)", () => {
  const root = mkdtempSync(join(tmpdir(), "bos-bootstrap-"));
  const bootstrapped = join(root, "bootstrapped");
  const bare = join(root, "bare");

  mkdirSync(join(bootstrapped, "node_modules"), { recursive: true });
  mkdirSync(bare);
  writeFileSync(
    join(bootstrapped, "package.json"),
    JSON.stringify({ scripts: { prepare: "node scripts/ensure-effect-toolchain.mjs" } }),
  );

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("names the bootstrap remedy when node_modules is absent", () => {
    const message = regenerationRemedy(bare, new Error("Cannot find package 'every-plugin'"));
    expect(message).toBe(
      "regeneration unavailable in this checkout — bootstrap it first: pnpm install (generation error: Cannot find package 'every-plugin')",
    );
  });

  it("includes prepare in the remedy when the checkout defines it", () => {
    const message = regenerationRemedy(
      bootstrapped,
      new Error("Cannot find module 'everything-dev/descriptor'"),
    );
    expect(message).toContain("pnpm install && pnpm run prepare");
  });

  it("remedies module-resolution failures even with node_modules present", () => {
    const error = new Error("Cannot find package 'every-plugin/ui/manifest-generator'");
    expect(regenerationRemedy(bootstrapped, error)).toContain("bootstrap it first");
  });

  it("passes bootstrapped-checkout failures through untouched (#652 scope)", () => {
    const error = new Error(
      "UNRESOLVED nostr (plugin-ui): fetch https://example.app/manifest.gen.json failed: HTTP 404 Not Found",
    );
    expect(regenerationRemedy(bootstrapped, error)).toBeNull();
  });

  it("renders non-Error failures without throwing", () => {
    expect(regenerationRemedy(bare, { code: "ENOENT" })).toContain("generation error:");
    expect(regenerationRemedy(bare, null)).toContain("generation error:");
  });
});
