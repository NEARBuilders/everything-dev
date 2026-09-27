import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ContractTypesStatus = "generated" | "up-to-date" | "skipped";

export const CONTRACT_ENTRY = path.join("src", "contract.ts");
export const CONTRACT_TYPES_DIR = "types";
export const CONTRACT_TYPES_FILE = path.join("types", "contract.d.ts");

export function contractTypesUpToDate(cwd: string): boolean {
  const entry = path.join(cwd, CONTRACT_ENTRY);
  const outFile = path.join(cwd, CONTRACT_TYPES_FILE);
  if (!fs.existsSync(entry) || !fs.existsSync(outFile)) return false;
  return fs.statSync(outFile).mtimeMs >= fs.statSync(entry).mtimeMs;
}

export function resolveTscBinary(cwd: string): string {
  for (const from of [
    path.join(cwd, "package.json"),
    path.join(import.meta.dirname, "..", "..", "..", "package.json"),
  ]) {
    try {
      const req = createRequire(path.resolve(from));
      const pkgJsonPath = req.resolve("typescript/package.json");
      return path.join(path.dirname(pkgJsonPath), "bin", "tsc");
    } catch {
      // try the next resolution root
    }
  }
  return "tsc";
}

/**
 * Regenerates types/contract.d.ts for a plugin workspace by invoking the
 * workspace's TypeScript 7 binary with explicit flags — no tsconfig file
 * involved, so emit layout is deterministic and there is nothing to sync.
 *
 * - "skipped": the workspace has no src/contract.ts
 * - "up-to-date": types/contract.d.ts is newer than src/contract.ts
 * - "generated": declarations were re-emitted (types/ is cleaned first, so
 *   stale nested layouts never survive)
 */
export async function generateContractTypes(
  cwd: string = process.cwd(),
): Promise<ContractTypesStatus> {
  const entry = path.join(cwd, CONTRACT_ENTRY);
  if (!fs.existsSync(entry)) {
    return "skipped";
  }

  if (contractTypesUpToDate(cwd)) {
    return "up-to-date";
  }

  const outDir = path.join(cwd, CONTRACT_TYPES_DIR);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const tsc = resolveTscBinary(cwd);
  const args = [
    "--ignoreConfig",
    "--emitDeclarationOnly",
    "--declaration",
    "--rootDir",
    "src",
    "--outDir",
    CONTRACT_TYPES_DIR,
    "--target",
    "esnext",
    "--module",
    "esnext",
    "--moduleResolution",
    "bundler",
    "--strict",
    "--skipLibCheck",
    CONTRACT_ENTRY,
  ];

  try {
    await execFileAsync(process.execPath, [tsc, ...args], { cwd });
  } catch (error) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    const detail = [err.stderr, err.stdout, err.message].filter(Boolean).join("\n").trim();
    throw new Error(
      `Contract type generation failed for ${path.basename(cwd)} — tsc exited non-zero:\n${detail}`,
    );
  }

  if (!fs.existsSync(path.join(cwd, CONTRACT_TYPES_FILE))) {
    throw new Error(
      `Contract type generation produced no output — expected ${path.join(cwd, CONTRACT_TYPES_FILE)}`,
    );
  }

  return "generated";
}
