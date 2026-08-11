import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  renderTypeErrors,
  runCommand,
  runTypecheck,
  unexpectedTypeErrors,
  writeGeneratedAuthStubs,
} from "./typecheck-utils";

const REPO_ROOT = join(import.meta.dirname, "../../../../");

describe("bos init — typecheck", () => {
  let testDir: string;
  let frameworkTarballs: Awaited<ReturnType<typeof getFrameworkTarballs>>;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), "bos-init-typecheck-"));
    frameworkTarballs = await getFrameworkTarballs(REPO_ROOT);
  }, 180_000);

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  }, 120_000);

  it("scaffolds project with template files", async () => {
    const patterns = buildInitPatterns(["ui", "api", "plugins"], ["apps", "template"], {
      template: "_template",
    });
    await copyFilteredFiles(REPO_ROOT, testDir, patterns, {
      overrides: ["ui", "api", "plugins"],
      plugins: ["apps", "template"],
    });

    await personalizeConfig(testDir, {
      extendsAccount: "dev.everything.near",
      extendsGateway: "dev.everything.dev",
      account: "test.near",
      domain: "test.dev",
      workspaceOpts: { sourceDir: REPO_ROOT },
      overrides: ["ui", "api", "plugins"],
      plugins: ["apps", "template"],
    });
    rewriteFrameworkPackageSpecs(testDir, frameworkTarballs);

    expect(existsSync(join(testDir, "bos.config.json"))).toBe(true);
    expect(existsSync(join(testDir, "ui", "src", "lib", "auth-types.gen.ts"))).toBe(true);
    expect(existsSync(join(testDir, "api", "src", "lib", "auth-types.gen.ts"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(testDir, "ui", "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@better-auth/core"]).toBe("catalog:");
  });

  it("sets postinstall to 'node node_modules/.bin/bos types gen || true'", async () => {
    const pkgPath = join(testDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.postinstall).toBe("node node_modules/.bin/bos types gen || true");
  });

  it("sets types:gen to 'node node_modules/.bin/bos types gen'", async () => {
    const pkgPath = join(testDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["types:gen"]).toBe("node node_modules/.bin/bos types gen");
  });

  it("installs dependencies", async () => {
    await runBunInstall(testDir);
    writeGeneratedAuthStubs(testDir);
    expect(existsSync(join(testDir, "node_modules"))).toBe(true);
  }, 180_000);

  it("generates types", async () => {
    const typesGen = await runCommand("bun", ["run", "types:gen"], testDir, 120_000);
    expect(typesGen.code).toBe(0);
    expect(existsSync(join(testDir, "ui", "src", "lib", "api-types.gen.ts"))).toBe(true);
    expect(existsSync(join(testDir, "api", "src", "lib", "plugins-types.gen.ts"))).toBe(true);

    writeGeneratedAuthStubs(testDir);
  }, 120_000);

  it("typechecks api with zero unexpected errors", async () => {
    const result = await runTypecheck(testDir, "api", { raw: true });
    const unexpected = unexpectedTypeErrors(result.stdout + result.stderr);

    if (unexpected.length > 0) {
      console.error(renderTypeErrors("api", unexpected));
    }

    assertTypecheckSuccess(result, "api");
  }, 120_000);

  it("typechecks ui with zero unexpected errors", async () => {
    const result = await runTypecheck(testDir, "ui", { raw: true });
    const unexpected = unexpectedTypeErrors(result.stdout + result.stderr);

    if (unexpected.length > 0) {
      console.error(renderTypeErrors("ui", unexpected));
    }

    assertTypecheckSuccess(result, "ui");
  }, 120_000);
});
