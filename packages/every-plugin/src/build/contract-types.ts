import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ContractTypesStatus = "generated" | "up-to-date" | "skipped";

export const CONTRACT_ENTRY = path.join("src", "contract.ts");
export const CONTRACT_TYPES_DIR = "types";
export const CONTRACT_TYPES_FILE = path.join("types", "contract.d.ts");

/**
 * Plugin workspaces can declare extra type-surface sources in package.json —
 * `"every-plugin": { "additionalExports": ["src/auth-export.ts"] }`. Each is
 * compiled to `types/<name>.d.ts`, emitted beside the bundle, and stamped as
 * `additionalExports` in plugin.manifest.json so remote consumers can fetch
 * the real shapes instead of stubbing them (`fetchAuthExportTypes`).
 */
export function readAdditionalExportsConfig(cwd: string): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")) as {
      "every-plugin"?: { additionalExports?: unknown };
    };
    const entries = pkg["every-plugin"]?.additionalExports;
    if (!Array.isArray(entries)) return [];
    return entries.filter(
      (entry): entry is string =>
        typeof entry === "string" && entry !== CONTRACT_ENTRY && entry.startsWith("src/"),
    );
  } catch {
    return [];
  }
}

export interface AdditionalExportArtifact {
  /** manifest path form — "./types/auth-export.d.ts" */
  path: string;
  /** exported type names, parsed from the emitted declaration */
  exports: string[];
  sha256: string;
  /** dist-relative file for the emitter to emit */
  file: string;
}

function declarationUpToDate(cwd: string, source: string, outFile: string): boolean {
  const entryPath = path.join(cwd, source);
  const outPath = path.join(cwd, outFile);
  if (!fs.existsSync(entryPath) || !fs.existsSync(outPath)) return false;
  return fs.statSync(outPath).mtimeMs >= fs.statSync(entryPath).mtimeMs;
}

const DECLARATION_ARGS = [
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
];

/**
 * Compiles each additional export source to `types/<name>.d.ts` and returns
 * the manifest `additionalExports` entries. Run AFTER `generateContractTypes`
 * — that leg cleans `types/` first, so these always regenerate fresh beside
 * it. A source missing from disk is skipped silently (the convention is
 * opt-in per workspace); a compile failure throws like the contract leg.
 */
export async function generateAdditionalExports(
  cwd: string = process.cwd(),
  sources: string[],
): Promise<AdditionalExportArtifact[]> {
  const artifacts: AdditionalExportArtifact[] = [];
  if (sources.length === 0) return artifacts;
  const tsc = resolveTscBinary(cwd);

  for (const source of sources) {
    const name = path.basename(source).replace(/\.tsx?$/, "");
    const outFile = path.join(CONTRACT_TYPES_DIR, `${name}.d.ts`);
    if (!fs.existsSync(path.join(cwd, source))) continue;

    if (!declarationUpToDate(cwd, source, outFile)) {
      try {
        await execFileAsync(process.execPath, [tsc, ...DECLARATION_ARGS, source], { cwd });
      } catch (error) {
        const err = error as { message?: string; stdout?: string; stderr?: string };
        const detail = [err.stderr, err.stdout, err.message].filter(Boolean).join("\n").trim();
        throw new Error(
          `Additional export type generation failed for ${source} in ${path.basename(cwd)} — tsc exited non-zero:\n${detail}`,
        );
      }
    }

    const outPath = path.join(cwd, outFile);
    if (!fs.existsSync(outPath)) {
      throw new Error(`Additional export type generation produced no output — expected ${outPath}`);
    }
    const content = fs.readFileSync(outPath, "utf-8");
    const exportNames = [
      ...new Set(
        [
          ...content.matchAll(
            /^export (?:declare )?(?:type|interface|const|class|function|enum) ([A-Za-z0-9_]+)/gm,
          ),
        ].map((match) => match[1]!),
      ),
    ];
    artifacts.push({
      path: `./${outFile}`,
      exports: exportNames,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
      file: outFile,
    });
  }
  return artifacts;
}

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
  const args = [...DECLARATION_ARGS, CONTRACT_ENTRY];

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
