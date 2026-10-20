import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { scanImports } from "../../../src/services/scaffold/upgrade-audit/checks/imports";

const conformant = join(
  import.meta.dirname,
  "../../../src/services/scaffold/upgrade-audit/fixtures/conformant",
);
const nonconformant = join(
  import.meta.dirname,
  "../../../src/services/scaffold/upgrade-audit/fixtures/nonconformant",
);

describe("scanImports", () => {
  it("finds no rewrites in the conformant fixture", async () => {
    const rewrites = await Effect.runPromise(scanImports(conformant));
    expect(rewrites.every((rewrite) => rewrite.files.length === 0)).toBe(true);
  });

  it("detects legacy @/auth imports and proposes @/app", async () => {
    const rewrites = await Effect.runPromise(scanImports(nonconformant));
    const authRewrite = rewrites.find((rewrite) => rewrite.from === 'from "@/auth"');
    expect(authRewrite?.files).toEqual(["ui/src/lib/legacy.ts"]);
    expect(authRewrite?.to).toBe('from "@/app"');
  });
});
