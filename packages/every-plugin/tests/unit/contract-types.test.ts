import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contractTypesUpToDate, generateContractTypes } from "../../src/build/contract-types";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "every-plugin-contract-types-"));
  mkdirSync(join(dir, "src"), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("generateContractTypes", () => {
  it("skips workspaces without src/contract.ts", async () => {
    expect(await generateContractTypes(dir)).toBe("skipped");
    expect(contractTypesUpToDate(dir)).toBe(false);
  });

  it("generates a fresh declaration and reports up-to-date afterwards", async () => {
    writeFileSync(
      join(dir, "src", "contract.ts"),
      `export const contract = { route: (name: string) => name };\n`,
    );
    expect(contractTypesUpToDate(dir)).toBe(false);

    expect(await generateContractTypes(dir)).toBe("generated");
    expect(contractTypesUpToDate(dir)).toBe(true);

    expect(await generateContractTypes(dir)).toBe("up-to-date");
  });

  it("regenerates when contract.ts is newer than the emitted declaration", async () => {
    writeFileSync(join(dir, "src", "contract.ts"), `export const contract = { a: 1 };\n`);
    await generateContractTypes(dir);

    const outFile = join(dir, "types", "contract.d.ts");
    expect(readFileSync(outFile, "utf8")).toContain("contract");

    utimesSync(join(dir, "src", "contract.ts"), new Date(), new Date(Date.now() + 10_000));
    expect(contractTypesUpToDate(dir)).toBe(false);
    expect(await generateContractTypes(dir)).toBe("generated");
  });

  it("reports compile failures with tsc diagnostics", async () => {
    writeFileSync(
      join(dir, "src", "contract.ts"),
      `export const contract: number = "not a number";\n`,
    );
    await expect(generateContractTypes(dir)).rejects.toThrow(/tsc exited non-zero/);
  });
});
