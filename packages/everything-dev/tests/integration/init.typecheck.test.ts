import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function parseTypeErrors(output: string): string[] {
  const lines = output.split("\n");
  const errors: string[] = [];
  let currentError: string[] = [];

  for (const line of lines) {
    if (/^\S+\(\d+,\d+\):\s*error\s+TS\d+/.test(line) || /^error\s+TS\d+/.test(line)) {
      if (currentError.length > 0) errors.push(currentError.join("\n"));
      currentError = [line];
    } else if (currentError.length > 0) {
      if (line.trim() === "" || /^\s+(TS\d+|Found \d+ error)/.test(line)) {
        errors.push(currentError.join("\n"));
        currentError = [];
      } else {
        currentError.push(line);
      }
    }
  }
  if (currentError.length > 0) errors.push(currentError.join("\n"));
  return errors;
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

function isUnexpectedError(error: string): boolean {
  const corePaths = [
    "ui/src/lib/",
    "ui/src/lib/api",
    "ui/src/lib/api-types.gen",
    "ui/src/lib/auth-types.gen",
    "api/src/contract",
    "api/src/index",
    "api/src/lib/plugins-types.gen",
    "api/src/lib/auth-types.gen",
  ];
  if (corePaths.some((p) => error.includes(p))) return true;

  if (error.includes(".gen.ts")) return true;

  return true;
}

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

    expect(existsSync(join(testDir, "bos.config.json"))).toBe(true);
    expect(existsSync(join(testDir, "ui", "src", "lib", "api-types.gen.ts"))).toBe(true);
    expect(existsSync(join(testDir, "ui", "src", "lib", "auth-types.gen.ts"))).toBe(true);
    expect(existsSync(join(testDir, "api", "src", "lib", "plugins-types.gen.ts"))).toBe(true);
    expect(existsSync(join(testDir, "api", "src", "lib", "auth-types.gen.ts"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(testDir, "ui", "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@better-auth/core"]).toBe("catalog:");
  });

  it("sets postinstall to 'bos types gen || true'", async () => {
    const pkgPath = join(testDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.postinstall).toBe("bos types gen || true");
  });

  it("sets types:gen to 'bos types gen'", async () => {
    const pkgPath = join(testDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["types:gen"]).toBe("bos types gen");
  });

  it("installs dependencies", async () => {
    await runBunInstall(testDir);
    writeGeneratedAuthStubs(testDir);
    const typesGen = await runCommand("bun", ["run", "types:gen"], testDir, 120_000);
    expect(existsSync(join(testDir, "node_modules"))).toBe(true);
    expect(typesGen.code).toBe(0);
  }, 120_000);

  it("typechecks api with zero unexpected errors", async () => {
    const result = await runCommand(
      "bun",
      ["run", "--cwd", "api", "tsc", "--noEmit"],
      testDir,
      120_000,
    );
    const errors = parseTypeErrors(result.stdout + result.stderr);
    const unexpected = errors.filter(isUnexpectedError);

    if (unexpected.length > 0) {
      console.error(`\nUnexpected API type errors:\n${unexpected.join("\n---\n")}`);
    }

    expect(result.code).toBe(0);
    expect(unexpected).toEqual([]);
  }, 120_000);

  it("typechecks ui with zero unexpected errors", async () => {
    const result = await runCommand(
      "bun",
      ["run", "--cwd", "ui", "tsc", "--noEmit"],
      testDir,
      120_000,
    );
    const errors = parseTypeErrors(result.stdout + result.stderr);
    const unexpected = errors.filter(isUnexpectedError);

    if (unexpected.length > 0) {
      console.error(`\nUnexpected UI type errors:\n${unexpected.join("\n---\n")}`);
    }

    expect(result.code).toBe(0);
    expect(unexpected).toEqual([]);
  }, 120_000);
});
