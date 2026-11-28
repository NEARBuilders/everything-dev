import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateAdditionalExports,
  readAdditionalExportsConfig,
} from "../../src/build/contract-types";

/**
 * The additionalExports producer (#936): package.json-declared type-surface
 * sources compile to types/<name>.d.ts artifacts whose manifest entries point
 * remote consumers at the real shapes (fetchAuthExportTypes consumes them).
 */
describe("generateAdditionalExports", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  const makeWorkspace = (packageJson: Record<string, unknown>): string => {
    const dir = mkdtempSync(join(tmpdir(), "additional-exports-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify(packageJson, null, 2));
    return dir;
  };

  const sourceFixture = {
    "src/auth-export.ts": [
      "export type Auth = { session: boolean };",
      "export type AuthOrganization = { id: string };",
      "const internal = 1;",
      "export default Auth;",
    ].join("\n"),
  };

  it("reads the every-plugin.additionalExports package.json config, filtering reserved entries", () => {
    const dir = makeWorkspace({
      everyPluginConfig: undefined,
      "every-plugin": {
        additionalExports: ["src/auth-export.ts", "src/contract.ts", 42, "not-src.ts"],
      },
    });
    expect(readAdditionalExportsConfig(dir)).toEqual(["src/auth-export.ts"]);
  });

  it("returns an empty config for a workspace without the key or package.json", () => {
    const dir = makeWorkspace({});
    expect(readAdditionalExportsConfig(dir)).toEqual([]);
    expect(readAdditionalExportsConfig(join(dir, "missing"))).toEqual([]);
  });

  it("compiles a source to types/<name>.d.ts with manifest path, exports, and sha256", async () => {
    const dir = makeWorkspace({});
    mkdirSync(join(dir, "src"), { recursive: true });
    for (const [file, content] of Object.entries(sourceFixture)) {
      writeFileSync(join(dir, file), content);
    }

    const artifacts = await generateAdditionalExports(dir, ["src/auth-export.ts"]);

    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0]!;
    expect(artifact.path).toBe("./types/auth-export.d.ts");
    expect(artifact.file).toEqual(join("types", "auth-export.d.ts"));
    expect(artifact.exports).toEqual(expect.arrayContaining(["Auth", "AuthOrganization"]));
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(dir, "types", "auth-export.d.ts"))).toBe(true);

    const content = readFileSync(join(dir, "types", "auth-export.d.ts"), "utf-8");
    expect(content).toContain("Auth");
    // sha256 matches the emitted bytes
    const crypto = await import("node:crypto");
    expect(artifact.sha256).toBe(crypto.createHash("sha256").update(content).digest("hex"));
  });

  it("skips sources that do not exist on disk", async () => {
    const dir = makeWorkspace({});
    const artifacts = await generateAdditionalExports(dir, ["src/not-there.ts"]);
    expect(artifacts).toEqual([]);
  });
});
