import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildInitPatterns,
  copyFilteredFiles,
  personalizeConfig,
  runBunInstall,
} from "../../src/cli/init";
import { getFrameworkTarballs, rewriteFrameworkPackageSpecs } from "./framework-packages";
import {
  assertTypecheckSuccess,
  runCommand,
  runTypecheck,
  writeGeneratedAuthStubs,
} from "./typecheck-utils";

const REPO_ROOT = join(import.meta.dirname, "../../../../");

describe.skipIf(process.env.CI !== "true")("bos init — full (install + typecheck)", () => {
  let testDir: string;
  let frameworkTarballs: Awaited<ReturnType<typeof getFrameworkTarballs>>;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), "bos-init-full-"));
    frameworkTarballs = await getFrameworkTarballs(REPO_ROOT);
  }, 180_000);

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  }, 120_000);

  it("installs dependencies", async () => {
    const patterns = buildInitPatterns(["ui", "api", "plugins"], ["apps"]);
    await copyFilteredFiles(REPO_ROOT, testDir, patterns, {
      overrides: ["ui", "api", "plugins"],
      plugins: ["apps"],
    });

    await personalizeConfig(testDir, {
      extendsAccount: "dev.everything.near",
      extendsGateway: "dev.everything.dev",
      account: "test.near",
      domain: "test.dev",
      workspaceOpts: { sourceDir: REPO_ROOT },
      overrides: ["ui", "api", "plugins"],
      plugins: ["apps"],
    });
    rewriteFrameworkPackageSpecs(testDir, frameworkTarballs);

    await runBunInstall(testDir);
    writeGeneratedAuthStubs(testDir);
    expect(existsSync(join(testDir, "node_modules"))).toBe(true);
  }, 120_000);

  it("typechecks successfully", async () => {
    const typesGenResult = await runCommand("bun", ["run", "types:gen"], testDir);
    expect(typesGenResult.code).toBe(0);

    const uiResult = await runTypecheck(testDir, "ui");
    const apiResult = await runTypecheck(testDir, "api");
    const pluginResult = await runTypecheck(testDir, "plugins/apps");

    assertTypecheckSuccess(uiResult, "ui");
    assertTypecheckSuccess(apiResult, "api");
    assertTypecheckSuccess(pluginResult, "plugins/apps");
  }, 120_000);
});
