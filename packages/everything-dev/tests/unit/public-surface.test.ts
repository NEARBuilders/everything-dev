import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PKG_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(PKG_DIR, "../..");
const pkg = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")) as {
  exports?: Record<string, unknown>;
};

interface Entry {
  sub: string;
  source: string;
  text: string;
}

function resolveEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const [sub, spec] of Object.entries(pkg.exports ?? {})) {
    if (sub === "./package.json") continue;
    if (typeof spec !== "object" || spec === null) continue;
    const dev = (spec as { development?: { types?: string; import?: string } }).development;
    const src = dev?.types ?? dev?.import ?? (spec as { types?: string }).types;
    if (!src || typeof src !== "string") continue;
    const file = resolve(PKG_DIR, src);
    expect(existsSync(file), `exports["${sub}"] points at missing source ${src}`).toBe(true);
    entries.push({ sub, source: file, text: readFileSync(file, "utf8") });
  }
  return entries;
}

const STAR_RE = /export\s+\*\s+from\s*["'][^"']+["']/g;
const REEXPORT_LIST_RE = /export\s+(?:type\s+)?\{[^}]*\}\s*from\s*["'][^"']+["']/g;

describe("public-surface guard", () => {
  const entries = resolveEntries();

  it("every exports entry resolves to a source file under the development condition", () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it("no entry is an export * barrel — re-export entries carry section comments", () => {
    const barrels: string[] = [];
    const unsectioned: string[] = [];
    for (const e of entries) {
      const stars = [...e.text.matchAll(STAR_RE)];
      if (stars.length > 0) {
        barrels.push(`${e.sub} (${relative(PKG_DIR, e.source)}): ${stars.length} export *`);
        continue;
      }
      const hasReexportLists = REEXPORT_LIST_RE.test(e.text);
      REEXPORT_LIST_RE.lastIndex = 0;
      const hasSectionComment = /^\s*\/\/\s+\S/m.test(e.text);
      if (hasReexportLists && !hasSectionComment) {
        unsectioned.push(relative(PKG_DIR, e.source));
      }
    }
    expect(
      barrels,
      "export * barrels make every accretion public API; replace with an explicit " +
        "named-export list with section comments (see src/db/index.ts for the shape)",
    ).toEqual([]);
    expect(
      unsectioned,
      "re-export entries must group their lists with // section comments (see src/db/index.ts)",
    ).toEqual([]);
  });

  it("symbol list per entry matches the snapshot (update it in the same PR as the export change)", () => {
    for (const e of entries) {
      const symbols = exportedSymbolsOf(e.text).sort(
        (a, b) =>
          a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
          a.kind.localeCompare(b.kind),
      );
      expect(symbols, `${e.sub} (${relative(PKG_DIR, e.source)})`).toMatchSnapshot(e.sub);
    }
  });

  it("zero-consumer symbols outside the defining module (advisory)", () => {
    const index = consumerIndex();
    const warnings: string[] = [];
    for (const e of entries) {
      for (const { name } of exportedSymbolsOf(e.text)) {
        if (isReferencedOutside(name, e.source, index)) continue;
        warnings.push(`${e.sub} :: ${name}`);
      }
    }
    if (warnings.length > 0) {
      process.stderr.write(
        `[public-surface] ${warnings.length} exported symbol(s) have zero references outside ` +
          `their defining module — before the next export lands here, name its consumer or ` +
          `keep it module-internal:\n  ${warnings.join("\n  ")}\n`,
      );
    }
  });
});

function exportedSymbolsOf(text: string): Array<{ name: string; kind: string }> {
  const out = new Map<string, string>();
  const add = (name: string, kind: string) => {
    if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !out.has(name)) out.set(name, kind);
  };
  for (const m of text.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(const|let|var|function\s*\*?|class|enum|interface|type)\s+([A-Za-z0-9_$]+)/g,
  )) {
    add(
      m[2],
      m[1].replace(/\s+/g, " ").replace("function *", "generator").replace("function", "function"),
    );
  }
  for (const m of text.matchAll(
    /export\s+(type\s+)?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?\s*;?/g,
  )) {
    for (let part of m[2].split(",")) {
      part = part.trim();
      if (!part) continue;
      const isType = m[1] !== undefined || /^type\s/.test(part);
      const name = (
        part
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop() ?? ""
      ).trim();
      add(name, isType ? "reexport-type" : "reexport");
    }
  }
  if (/export\s+default\s/.test(text)) add("default", "default");
  return [...out].map(([name, kind]) => ({ name, kind }));
}

const SCAN_ROOTS = [
  "host/src",
  "ui/src",
  "api/src",
  "plugins",
  ".github/templates",
  "packages/everything-dev/src",
  "packages/everything-dev/tests",
  "tests/regression",
  "packages/every-plugin/src",
  "packages/better-near-auth/src",
];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".bos",
  ".git",
  ".turbo",
  "coverage",
  "build",
  "test-results",
]);

const MAX_FILE_BYTES = 512 * 1024;

let cachedIndex: Array<{ file: string; text: string }> | null = null;

/**
 * Consumer-scan rule (#737): a symbol counts as consumed when any file under
 * the roots below references it outside the defining module. The scan roots
 * deliberately include the emitted-code producers — descriptor/serialize.ts,
 * services/scaffold/**, and the every-plugin stub templates — because child
 * repos import public specifiers through their output by design. Generated
 * `*.gen.ts` artifacts are excluded: they are downstream copies of contracts,
 * not reviewable source.
 */
function consumerIndex(): Array<{ file: string; text: string }> {
  if (cachedIndex) return cachedIndex;
  const files: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 10) return;
    let dirents: Dirent[];
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      const full = join(dir, d.name);
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name)) walk(full, depth + 1);
        continue;
      }
      if (!/\.(ts|tsx|mts|mjs|cjs)$/.test(d.name)) continue;
      if (/\.gen\.(ts|tsx)$/.test(d.name) || /\.d\.(mts|ts)$/.test(d.name)) continue;
      try {
        if (statSync(full).size > MAX_FILE_BYTES) continue;
      } catch {
        continue;
      }
      files.push(full);
    }
  };
  for (const root of SCAN_ROOTS) {
    const full = resolve(REPO_ROOT, root);
    if (existsSync(full)) walk(full, 0);
  }
  cachedIndex = files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
  return cachedIndex;
}

function isReferencedOutside(
  symbol: string,
  definingFile: string,
  index: Array<{ file: string; text: string }>,
): boolean {
  const pattern = new RegExp(`\\b${symbol.replace(/\$/g, "\\$")}\\b`);
  for (const { file, text } of index) {
    if (resolve(file) === resolve(definingFile)) continue;
    if (text.includes(symbol) && pattern.test(text)) return true;
  }
  return false;
}
