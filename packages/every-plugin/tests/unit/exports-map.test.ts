import { describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import { generateExports } from "../../scripts/sync-exports";

describe("exports map", () => {
  it("derives from tsdown-entries.ts — run `bun run --cwd packages/every-plugin exports:sync` to stamp", () => {
    expect(packageJson.exports).toEqual(generateExports());
  });
});
