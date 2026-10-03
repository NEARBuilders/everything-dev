import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isFrameworkOwnedSyncFile } from "./sync";

const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".css",
  ".json",
  ".png",
  ".gif",
  ".svg",
  ".jpg",
  ".webp",
  ".ico",
  ".mjs",
];

export interface PruneResult {
  pruned: string[];
  reachable: number;
}

interface ImportRef {
  names: string[] | null;
  source: string;
}

function splitNamedImports(clause: string): { names: string[]; wholeModule: boolean } {
  let wholeModule = false;
  const names: string[] = [];
  const withoutNamed = clause.replace(/\{[^}]*\}/g, " ").replace(/^\s*(?:import|export)\b/, "");
  for (const piece of withoutNamed.split(",")) {
    const token = piece.trim();
    if (!token) continue;
    if (token.includes("*")) {
      wholeModule = true;
      continue;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(token)) wholeModule = true;
  }
  const namedRe = /\{([^}]*)\}/g;
  for (const named of clause.matchAll(namedRe)) {
    for (const piece of named[1].split(",")) {
      const name = piece
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name && name !== "default") names.push(name);
    }
  }
  return { names, wholeModule };
}

function collectImportRefs(content: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const fromRe = /(?:import|export)\s+[\s\S]*?from\s*["']([^"']+)["']/g;
  for (const match of content.matchAll(fromRe)) {
    const clause = match[0].slice(0, match[0].lastIndexOf("from"));
    const { names, wholeModule } = splitNamedImports(clause);
    refs.push({ names: wholeModule ? null : names, source: match[1] });
  }
  for (const match of content.matchAll(/import\s*["']([^"']+)["']/g)) {
    refs.push({ names: null, source: match[1] });
  }
  // Dynamic imports keep the target alive (conservative)
  for (const match of content.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    refs.push({ names: null, source: match[1] });
  }
  return refs;
}

function resolveSpecifier(specifier: string, fromFile: string, uiDir: string): string | null {
  let base: string | null = null;
  if (specifier.startsWith("@/")) {
    base = join(uiDir, specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }
  const candidates: string[] = [];
  for (const ext of EXTENSIONS) {
    candidates.push(`${base}${ext}`);
  }
  for (const ext of EXTENSIONS) {
    candidates.push(join(base, `index${ext}`));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface BarrelExport {
  name: string;
  source: string | null;
}

function parseBarrelExports(content: string, barrelPath: string, srcDir: string): BarrelExport[] {
  const exports: BarrelExport[] = [];
  const re = /export\s+\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of content.matchAll(re)) {
    for (const piece of match[1].split(",")) {
      const name = piece
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (!name || name === "default") continue;
      exports.push({ name, source: resolveSpecifier(match[2], barrelPath, srcDir) });
    }
  }
  return exports;
}

function listFilesRecursive(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listFilesRecursive(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function isProtected(relPath: string, srcDir: string): boolean {
  const withinSrc = relative(srcDir, relPath);
  if (withinSrc.startsWith("..") || isAbsolute(withinSrc)) return true;
  // Root-level src files (entry, app, compose, styles, globals) are the
  // framework's entry surface — never pruned.
  if (!withinSrc.includes("/")) return true;
  if (withinSrc.startsWith("routes/")) return true;
  if (/\.gen\.(ts|tsx|json)$/.test(withinSrc)) return true;
  if (isFrameworkOwnedSyncFile(join("ui/src", withinSrc))) return true;
  return false;
}

function subjectOfTestFile(file: string): string | null {
  const match = file.match(/^(?:(?<dir>.+)\/)?(?<name>.+)\.test\.tsx?$/);
  if (!match?.groups) return null;
  const base = match.groups.dir ? `${match.groups.dir}/${match.groups.name}` : match.groups.name;
  for (const ext of [".tsx", ".ts"]) {
    if (existsSync(`${base}${ext}`)) return `${base}${ext}`;
  }
  return null;
}

/**
 * Prune copied ui source files that no copied route or framework-owned file
 * can reach via static imports. Named imports through the components barrel
 * keep only the named exports' files alive; a namespace/default import of the
 * barrel keeps everything it exports. Framework-owned files, generated types,
 * and route files are never pruned; a test file lives or dies with the file
 * it tests.
 */
export function pruneUnusedUiFiles(
  targetDir: string,
  options: { log?: (message: string) => void } = {},
): PruneResult {
  const srcDir = join(targetDir, "ui", "src");
  if (!existsSync(srcDir)) return { pruned: [], reachable: 0 };

  const allFiles = listFilesRecursive(srcDir);

  const barrelPath = join(srcDir, "components", "index.ts");
  const barrelExports = existsSync(barrelPath)
    ? parseBarrelExports(readFileSync(barrelPath, "utf-8"), barrelPath, srcDir)
    : [];
  let barrelSaturated = false;

  const reachable = new Set<string>();
  const queue: string[] = [];

  const saturateBarrel = (): void => {
    for (const exp of barrelExports) {
      if (exp.source) visit(exp.source, null);
    }
  };

  function visit(file: string, wantedNames: string[] | null): void {
    if (file === barrelPath) {
      if (wantedNames === null) {
        barrelSaturated = true;
      }
      if (reachable.has(file)) {
        if (wantedNames === null) saturateBarrel();
        return;
      }
      reachable.add(file);
      if (wantedNames === null) {
        saturateBarrel();
      } else {
        for (const exp of barrelExports) {
          if (exp.source && wantedNames.includes(exp.name)) visit(exp.source, null);
        }
      }
      return;
    }
    if (reachable.has(file)) return;
    reachable.add(file);
    queue.push(file);
  }

  for (const file of allFiles) {
    if (isProtected(file, srcDir)) visit(file, null);
  }

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (!existsSync(file)) continue;
    // The barrel's own export statements are traversed only through the
    // wanted-names path in visit() — never as whole-file imports.
    if (file === barrelPath) continue;
    const content = readFileSync(file, "utf-8");
    for (const ref of collectImportRefs(content)) {
      const resolved = resolveSpecifier(ref.source, file, srcDir);
      if (!resolved) continue;
      visit(resolved, ref.names);
    }
  }
  if (barrelSaturated) saturateBarrel();

  const removed: string[] = [];
  for (const file of allFiles) {
    if (reachable.has(file)) continue;
    if (isProtected(file, srcDir)) continue;
    const subject = subjectOfTestFile(file);
    if (subject && (reachable.has(subject) || isProtected(subject, srcDir))) continue;
    rmSync(file);
    removed.push(relative(targetDir, file));
  }

  // Drop barrel export statements pointing at pruned files (statement spans,
  // so multi-line `export { ... } from "..."` blocks are removed whole).
  if (existsSync(barrelPath) && removed.length > 0) {
    const content = readFileSync(barrelPath, "utf-8");
    const spans: Array<[number, number]> = [];
    for (const match of content.matchAll(/export\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/g)) {
      const fromMatch = match[0].match(/from\s*["']([^"']+)["']/);
      if (!fromMatch) continue;
      const target = resolveSpecifier(fromMatch[1], barrelPath, srcDir);
      if (!target || !existsSync(target)) {
        spans.push([match.index, match.index + match[0].length]);
      }
    }
    if (spans.length > 0) {
      let next = "";
      let cursor = 0;
      for (const [start, end] of spans) {
        next += content.slice(cursor, start);
        cursor = end;
      }
      next += content.slice(cursor);
      // Collapse blank-line runs left behind by removed statements
      next = next.replace(/\n{3,}/g, "\n\n");
      writeFileSync(barrelPath, next);
    }
  }

  // Remove directories left empty by the prune (git ignores empty dirs, but
  // the scaffold on disk should not carry hollow folders).
  for (const candidate of ["components", "lib", "hooks", "providers", "integrations"]) {
    const dir = join(srcDir, candidate);
    removeIfEmpty(dir);
  }

  if (removed.length > 0) {
    options.log?.(`pruned ${removed.length} unreferenced ui file(s)`);
  }
  return { pruned: removed, reachable: reachable.size };
}

function removeIfEmpty(dir: string): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  if (entries.length === 0) {
    rmSync(dir, { recursive: true });
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) removeIfEmpty(full);
  }
  if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}
