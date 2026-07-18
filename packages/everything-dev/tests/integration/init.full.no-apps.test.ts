import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const REPO_ROOT = join(import.meta.dirname, "../../../../");

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeout = 120_000,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { cwd, stdio: "pipe" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command '${command} ${args.join(" ")}' timed out after ${timeout}ms`));
    }, timeout);
    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function writeGeneratedAuthStubs(projectDir: string) {
  const authDir = join(projectDir, ".bos", "generated", "auth");
  mkdirSync(authDir, { recursive: true });
  writeFileSync(
    join(authDir, "auth-export.d.ts"),
    `export type Auth = any;
export type AuthOrganizationContext = any;
export type AuthOrganization = any;
export type AuthOrganizationSummary = any;
export type AuthOrganizationMember = any;
export type AuthApiKey = any;
export type AuthInvitation = any;
export type GetActiveMemberInput = any;
export type GetOrganizationInput = any;
export type ListMembersInput = any;
export type ListInvitationsInput = any;
export type ListApiKeysInput = any;
export type AuthServices = any;
export type createAuthInstance = any;
`,
  );
  writeFileSync(
    join(authDir, "contract.d.ts"),
    `export type ContractType = any;
export type InferOutput<_TRoute extends string> = any;
`,
  );
}

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

      await runBunInstall(testDir);
      writeGeneratedAuthStubs(testDir);
      expect(existsSync(join(testDir, "node_modules"))).toBe(true);
    }, 120_000);

    it("typechecks successfully without apps plugin API namespace", async () => {
      const result = await runCommand("bun", ["typecheck"], testDir);

      if (result.code !== 0) {
        console.error(`\nUnexpected no-apps typecheck output:\n${result.stdout}${result.stderr}`);
      }

      expect(result.code).toBe(0);
    }, 120_000);
  },
);
