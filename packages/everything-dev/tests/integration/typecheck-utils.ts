import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Data } from "effect";
import { expect } from "vitest";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCommand(
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

export function writeGeneratedAuthStubs(projectDir: string) {
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

export function writeGeneratedTypeStubsEmpty(projectDir: string) {
  const apiLibDir = join(projectDir, "api", "src", "lib");
  mkdirSync(apiLibDir, { recursive: true });
  writeFileSync(
    join(apiLibDir, "plugins-types.gen.ts"),
    `import type { ContractRouterClient, AnyContractRouter } from "@orpc/contract";
type ClientFactory<C extends AnyContractRouter> = (context?: Record<string, unknown>) => ContractRouterClient<C>;
export type PluginsClient = Record<string, never>;
`,
  );

  const uiLibDir = join(projectDir, "ui", "src", "lib");
  mkdirSync(uiLibDir, { recursive: true });
  writeFileSync(
    join(uiLibDir, "api-types.gen.ts"),
    `import type { ContractType as BaseApiContract } from "../../../api/src/contract.ts";
export type ApiContract = BaseApiContract;
`,
  );
}

const CORE_PATHS = [
  "ui/src/lib/",
  "ui/src/lib/api",
  "ui/src/lib/api-types.gen",
  "ui/src/lib/auth-types.gen",
  "api/src/contract",
  "api/src/index",
  "api/src/lib/plugins-types.gen",
  "api/src/lib/auth-types.gen",
];

export function isUnexpectedError(error: string): boolean {
  if (CORE_PATHS.some((p) => error.includes(p))) return true;
  if (error.includes(".gen.ts")) return true;
  return false;
}

export function parseTypeErrors(output: string): string[] {
  const lines = output.split("\n");
  const errors: string[] = [];
  let currentError: string[] = [];

  for (const line of lines) {
    if (
      /^(?:Error:\s*)?\S+\(\d+,\d+\):\s*error\s+TS\d+/.test(line) ||
      /^(?:Error:\s*)?error\s+TS\d+/.test(line)
    ) {
      if (currentError.length > 0) errors.push(currentError.join("\n"));
      currentError = [line];
    } else if (currentError.length > 0) {
      const trimmed = line.trim();
      if (
        trimmed === "" ||
        /^\s*(TS\d+|Found \d+ errors?)/.test(line) ||
        trimmed.startsWith("$ ") ||
        trimmed.startsWith("error:")
      ) {
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

const FIX_HINTS: Record<string, string> = {
  TS2339:
    "Property does not exist — run `bun run types:gen` to regenerate API/types after a contract or plugin change",
  TS2353:
    "Object literal has an unknown property — likely a stale generated type; run `bun run types:gen`",
  TS2304:
    "Cannot find name — missing import or removed symbol; check the import and run `bun run types:gen`",
  TS2307: "Cannot find module — missing dependency or bad import path; check package.json",
  TS2322:
    "Type is not assignable — the expected signature changed upstream (framework/contract); review the type at the target",
  TS2722:
    "Cannot invoke possibly-undefined — add a guard (e.g. `if (value)`) or non-null assertion before calling",
  TS18048: "Value is possibly undefined — narrow with a guard or optional chaining before use",
  TS2532: "Object is possibly undefined — guard or use optional chaining before property access",
  TS2554: "Wrong number of arguments — the function signature may have changed upstream; check it",
};

const DEFAULT_FIX_HINT =
  "Review the error location and the target type — it may need a guard, a type fix, or regenerated types";

const ERROR_HEADER = /^(\S+)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.*)$/;

export class TypeErrorDetail extends Data.TaggedError("TypeErrorDetail")<{
  location: string;
  line: number;
  code: string;
  message: string;
  fixHint: string;
  raw: string;
}> {}

function parseTypeErrorDetail(raw: string): TypeErrorDetail {
  const firstLine = raw.split("\n")[0] ?? raw;
  const match = ERROR_HEADER.exec(firstLine);
  const code = match?.[4] ?? "TS0000";
  const message = match
    ? `${match[5]}${raw.slice(firstLine.length)}`
    : raw.split("\n").slice(1).join(" ").trim() || raw;
  const isGeneratedType = raw.includes(".gen.ts");
  return new TypeErrorDetail({
    location: match ? `${match[1]}:${match[2]}` : firstLine,
    line: match ? Number(match[2]) : 0,
    code,
    message: message.trim(),
    fixHint: isGeneratedType
      ? "Generated types are stale — run `bun run types:gen`"
      : (FIX_HINTS[code] ?? DEFAULT_FIX_HINT),
    raw: raw.trim(),
  });
}

export function unexpectedTypeErrors(output: string): TypeErrorDetail[] {
  return parseTypeErrors(output).filter(isUnexpectedError).map(parseTypeErrorDetail);
}

export function renderTypeErrors(workspace: string, errors: TypeErrorDetail[]): string {
  const lines = errors.map((error) => {
    return [
      `  ${error.location} error ${error.code}`,
      `    ${error.message}`,
      `    -> ${error.fixHint}`,
    ].join("\n");
  });
  return [`Typecheck failed (${workspace}):`, ...lines].join("\n");
}

export function runTypecheck(
  projectDir: string,
  workspace: string,
  opts: { timeout?: number; raw?: boolean } = {},
): Promise<CommandResult> {
  const args = opts.raw
    ? ["run", "--cwd", workspace, "tsc", "--noEmit"]
    : ["run", "--cwd", workspace, "typecheck"];
  return runCommand("bun", args, projectDir, opts.timeout ?? 120_000);
}

export function assertTypecheckSuccess(result: CommandResult, workspace: string): void {
  const output = result.stdout + result.stderr;
  const unexpected = unexpectedTypeErrors(output);
  let receivedErrors: TypeErrorDetail[];

  if (unexpected.length > 0) {
    receivedErrors = unexpected;
  } else if (result.code !== 0) {
    receivedErrors = parseTypeErrors(output).map(parseTypeErrorDetail);
    if (receivedErrors.length === 0) {
      receivedErrors = [
        new TypeErrorDetail({
          location: "(typecheck output)",
          line: 0,
          code: "TS0000",
          message: summarizeOutput(output),
          fixHint: "Inspect the full typecheck output for this workspace",
          raw: output.trim(),
        }),
      ];
    }
  } else {
    receivedErrors = [];
  }

  expect({ workspace, exitCode: result.code, unexpectedErrors: receivedErrors }).toEqual({
    workspace,
    exitCode: 0,
    unexpectedErrors: [],
  });
}

export async function runAndAssertTypecheck(
  projectDir: string,
  workspace: string,
  opts: { timeout?: number; raw?: boolean } = {},
): Promise<void> {
  const result = await runTypecheck(projectDir, workspace, opts);
  assertTypecheckSuccess(result, workspace);
}

function summarizeOutput(output: string, maxLines = 40): string {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-maxLines)
    .join("\n");
}
