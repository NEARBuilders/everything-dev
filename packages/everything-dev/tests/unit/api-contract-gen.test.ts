import {
  existsSync,
  writeFileSync as fsWriteFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let testDir: string;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

function makeContractSource(key: string, filePath: string, importName?: string) {
  return { key, sourceFilePath: filePath, importName: importName ?? `${key}Contract` };
}

function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  fsWriteFileSync(path, content, "utf-8");
}

describe("writeGeneratedFiles — apiDependsOn filtering", () => {
  it("includes all plugins + auth when apiDependsOn is not set", async () => {
    const { writeGeneratedFiles } = await import("../../src/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-test-"));

    const apiSrc = join(testDir, "api", "src");
    const uiLib = join(testDir, "ui", "src", "lib");
    const apiLib = join(testDir, "api", "src", "lib");
    const authSrc = join(testDir, "plugins", "auth", "src");
    const pluginASrc = join(testDir, "plugins", "pluginA", "src");
    const pluginBSrc = join(testDir, "plugins", "pluginB", "src");

    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");

    const resultPath = writeGeneratedFiles({
      configDir: testDir,
      sources: [
        makeContractSource("api", contractPath),
        makeContractSource("pluginA", join(pluginASrc, "contract.ts")),
        makeContractSource("pluginB", join(pluginBSrc, "contract.ts")),
      ],
      pluginKeys: ["pluginA", "pluginB"],
      authSource: makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      apiDependsOn: undefined,
    });

    expect(resultPath).toBe(join(uiLib, "api-types.gen.ts"));

    const pluginsTypes = readFileSync(join(apiLib, "plugins-types.gen.ts"), "utf-8");
    expect(pluginsTypes).toContain("authContract");
    expect(pluginsTypes).toContain("pluginAContract");
    expect(pluginsTypes).toContain("pluginBContract");
  });

  it("filters plugins-types.gen.ts when apiDependsOn is set", async () => {
    const { writeGeneratedFiles } = await import("../../src/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-test-"));

    const apiSrc = join(testDir, "api", "src");
    const apiLib = join(testDir, "api", "src", "lib");
    const authSrc = join(testDir, "plugins", "auth", "src");
    const pluginASrc = join(testDir, "plugins", "pluginA", "src");
    const pluginBSrc = join(testDir, "plugins", "pluginB", "src");

    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");

    writeGeneratedFiles({
      configDir: testDir,
      sources: [
        makeContractSource("api", contractPath),
        makeContractSource("pluginA", join(pluginASrc, "contract.ts")),
        makeContractSource("pluginB", join(pluginBSrc, "contract.ts")),
      ],
      pluginKeys: ["pluginA", "pluginB"],
      authSource: makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      apiDependsOn: ["pluginA", "auth"],
    });

    const pluginsTypes = readFileSync(join(apiLib, "plugins-types.gen.ts"), "utf-8");
    expect(pluginsTypes).toContain("pluginAContract");
    expect(pluginsTypes).toContain("authContract");
    expect(pluginsTypes).not.toContain("pluginBContract");
  });

  it("generates per-plugin plugins-client.gen.ts from pluginDependsOn", async () => {
    const { writeGeneratedFiles } = await import("../../src/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-test-"));

    const apiSrc = join(testDir, "api", "src");
    const authSrc = join(testDir, "plugins", "auth", "src");
    const pluginASrc = join(testDir, "plugins", "pluginA", "src");
    const pluginBSrc = join(testDir, "plugins", "pluginB", "src");

    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");
    mkdirSync(pluginASrc, { recursive: true });
    mkdirSync(pluginBSrc, { recursive: true });

    writeGeneratedFiles({
      configDir: testDir,
      sources: [
        makeContractSource("api", contractPath),
        makeContractSource("pluginA", join(pluginASrc, "contract.ts")),
        makeContractSource("pluginB", join(pluginBSrc, "contract.ts")),
      ],
      pluginKeys: ["pluginA", "pluginB"],
      authSource: makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      apiDependsOn: ["pluginA", "pluginB"],
      pluginDependsOn: {
        pluginA: ["auth"],
        pluginB: ["pluginA"],
      },
    });

    const pluginAClientPath = join(pluginASrc, "plugins-client.gen.ts");
    expect(existsSync(pluginAClientPath)).toBe(true);
    const pluginAClient = readFileSync(pluginAClientPath, "utf-8");
    expect(pluginAClient).toContain("authContract");
    expect(pluginAClient).not.toContain("pluginBContract");

    const pluginBClientPath = join(pluginBSrc, "plugins-client.gen.ts");
    expect(existsSync(pluginBClientPath)).toBe(true);
    const pluginBClient = readFileSync(pluginBClientPath, "utf-8");
    expect(pluginBClient).toContain("pluginAContract");
    expect(pluginBClient).not.toContain("authContract");
  });
});
