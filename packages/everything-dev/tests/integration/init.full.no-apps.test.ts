import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildInitPatterns,
  buildPluginRouteExclusions,
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
  writeGeneratedTypeStubsEmpty,
} from "./typecheck-utils";

const REPO_ROOT = join(import.meta.dirname, "../../../../");

describe.skipIf(process.env.CI !== "true")(
  "bos init — no apps plugin (install + typecheck)",
  () => {
    let testDir: string;
    let frameworkTarballs: Awaited<ReturnType<typeof getFrameworkTarballs>>;

    beforeAll(async () => {
      testDir = mkdtempSync(join(tmpdir(), "bos-init-no-apps-"));
      frameworkTarballs = await getFrameworkTarballs(REPO_ROOT);
    }, 180_000);

    afterAll(() => {
      rmSync(testDir, { recursive: true, force: true });
    }, 120_000);

    it("scaffolds without apps plugin routes", async () => {
      const patterns = buildInitPatterns(["ui", "api"], []);
      const parentConfig = JSON.parse(
        readFileSync(join(REPO_ROOT, "bos.config.json"), "utf-8"),
      ) as Record<string, unknown>;
      const routeExclusions = buildPluginRouteExclusions(parentConfig, []);
      await copyFilteredFiles(REPO_ROOT, testDir, patterns, {
        overrides: ["ui", "api"],
        plugins: [],
        ignore: routeExclusions,
      });

      expect(existsSync(join(testDir, "ui/src/routes/_layout/apps"))).toBe(false);
      expect(existsSync(join(testDir, "ui/src/routes/_layout/index.tsx"))).toBe(true);

      await personalizeConfig(testDir, {
        extendsAccount: "dev.everything.near",
        extendsGateway: "dev.everything.dev",
        account: "test.near",
        domain: "test.dev",
        workspaceOpts: { sourceDir: REPO_ROOT },
        overrides: ["ui", "api"],
        plugins: [],
      });
      rewriteFrameworkPackageSpecs(testDir, frameworkTarballs);
      writeGeneratedTypeStubsEmpty(testDir);

      await runBunInstall(testDir);
      writeGeneratedAuthStubs(testDir);
      expect(existsSync(join(testDir, "node_modules"))).toBe(true);
    }, 120_000);

    it("typechecks successfully without apps plugin API namespace", async () => {
      const typesGenResult = await runCommand("bun", ["run", "types:gen"], testDir, 60_000);
      if (typesGenResult.code !== 0) {
        console.warn(
          `\nNo-apps types:gen could not regenerate (placeholder stubs in use):\n${typesGenResult.stdout}${typesGenResult.stderr}`,
        );
      }

      const uiResult = await runTypecheck(testDir, "ui");
      const apiResult = await runTypecheck(testDir, "api");

      assertTypecheckSuccess(uiResult, "ui");
      assertTypecheckSuccess(apiResult, "api");
    }, 120_000);
  },
);
