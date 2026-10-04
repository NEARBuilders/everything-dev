#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";

const repoRoot = process.cwd();

// Scope: the live navigation surface — files agents read on arrival and that
// claim to describe the current repo. Deliberately excluded: docs/adr/*.md
// bodies and docs/plans/*.md bodies (dated records; ADRs cite their PR/commit,
// plans self-stamp with `git rev-parse` for their own drift detection), and
// CHANGELOG.md (historical by convention).
const FILE_SCOPES = [
  "AGENTS.md",
  "GLOSSARY.md",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  "ui/README.md",
  "ui/DESIGN.md",
  "host/README.md",
  "docs/agents",
  "docs/adr/README.md",
  "docs/plans/README.md",
  "packages/everything-dev/skills",
  "packages/every-plugin/skills",
  "packages/better-near-auth/skills",
  ".agents/skills/everything-dev-app",
  ".agents/skills/fastkv-registry",
  ".agents/skills/improve",
];

const KNOWN_EXTENSIONS = new Set([
  "md",
  "mdx",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "yaml",
  "yml",
  "sh",
  "sql",
  "toml",
  "html",
  "css",
  "txt",
  "svg",
  "go",
]);

const DIR_PREFIXES = [
  "docs/",
  ".scratch/",
  ".agents/",
  ".github/",
  "scripts/",
  "host/",
  "ui/",
  "api/",
  "plugins/",
  "packages/",
];

// Targets under these prefixes are generated, runtime-local, or authored for
// other repos — they can never be resolved from a clean checkout.
const TARGET_SKIP_PREFIXES = [".bos/", ".every-plugin/", ".claude/", "dist/"];

// Upstream skills glob for ADRs across several conventional locations; only
// docs/adr/ exists here and the others are deliberate no-op candidates.
const TARGET_SKIP_SET = new Set(["docs/adrs", "docs/decisions"]);

const SKIP_LINE_MARKER = "<!-- docs-check:skip";

const SKIP_SEGMENTS = new Set(["node_modules", ".git", ".bos", "dist", ".tanstack", "repos"]);

function collectMarkdownFiles(entry, files) {
  const full = join(repoRoot, entry);
  if (!existsSync(full)) return;
  if (statSync(full).isFile()) {
    files.push(entry);
    return;
  }
  for (const segment of readdirSync(full)) {
    if (SKIP_SEGMENTS.has(segment) || segment === "CHANGELOG.md") continue;
    const child = posix.join(entry, segment);
    if (statSync(join(repoRoot, child)).isDirectory()) {
      collectMarkdownFiles(child, files);
    } else if (child.endsWith(".md")) {
      files.push(child);
    }
  }
}

const markdownFiles = [];
for (const entry of FILE_SCOPES) collectMarkdownFiles(entry, markdownFiles);

function looksLikePathWithExtension(span) {
  if (!span.includes("/")) return false;
  if (/[\s*<>|~@${}]/.test(span)) return false;
  if (span.includes("://") || span.includes("NNN")) return false;
  if (span.startsWith("#") || span.startsWith("/")) return false;
  const extension = span.split(".").pop()?.toLowerCase();
  return Boolean(extension) && KNOWN_EXTENSIONS.has(extension);
}

function looksLikeAllowedDirectory(span) {
  if (!span.endsWith("/")) return false;
  if (/[\s*<>|~@${}]/.test(span.slice(0, -1))) return false;
  return DIR_PREFIXES.some((prefix) => span.startsWith(prefix));
}

function resolutionCandidates(sourceFile, target) {
  const sourceDir = dirname(join(repoRoot, sourceFile));
  const candidates = [
    join(sourceDir, target),
    join(repoRoot, target),
    join(repoRoot, "packages", target),
    join(repoRoot, "packages/everything-dev", target),
    join(repoRoot, "packages/every-plugin", target),
    join(repoRoot, "packages/better-near-auth", target),
    join(repoRoot, "plugins/_template", target),
  ];
  return candidates.map((candidate) => relative(repoRoot, candidate));
}

function targetExists(sourceFile, target) {
  const clean = target.replace(/[#?].*$/, "").replace(/\/+$/, "");
  if (!clean) return true;
  if (
    TARGET_SKIP_SET.has(clean) ||
    TARGET_SKIP_PREFIXES.some((prefix) => clean.startsWith(prefix))
  ) {
    return true;
  }
  const candidates = resolutionCandidates(sourceFile, clean);
  if (candidates.some((candidate) => existsSync(join(repoRoot, candidate)))) {
    return true;
  }
  // A target that exists only after generation (routeTree.gen.ts, *.gen.ts
  // type files) is gitignored, so a clean checkout never has it. Skip those:
  // references to generated artifacts are descriptions, not navigation.
  return candidates.some((candidate) => isGitIgnored(candidate));
}

const gitIgnoreChecked = new Map();

function isGitIgnored(candidate) {
  const cached = gitIgnoreChecked.get(candidate);
  if (cached !== undefined) return cached;
  let ignored = false;
  try {
    execFileSync("git", ["check-ignore", "-q", candidate], { cwd: repoRoot, stdio: "ignore" });
    ignored = true;
  } catch (error) {
    ignored = error.status === 0;
  }
  gitIgnoreChecked.set(candidate, ignored);
  return ignored;
}

function extractFromFrontmatterSources(content, broken, sourceFile) {
  const frontmatter = content.match(/^---\n[\s\S]*?\n---/);
  if (!frontmatter) return;
  const sourcesBlock = frontmatter[0].match(/sources:\s*\n((?:\s+-\s+"[^"]+"\n?)+)/);
  if (sourcesBlock) {
    for (const entry of sourcesBlock[1].matchAll(/-\s+"([^"]+)"/g)) {
      const target = entry[1];
      if (target.includes(":")) continue;
      if (!targetExists(sourceFile, target)) {
        broken.push({ sourceFile, line: 0, target });
      }
    }
    return;
  }
  const inlineSources = frontmatter[0].match(/sources:\s*"([^"]+)"/);
  if (inlineSources) {
    for (const target of inlineSources[1].split(",")) {
      const clean = target.trim();
      if (!clean) continue;
      if (!targetExists(sourceFile, clean)) {
        broken.push({ sourceFile, line: 0, target: clean });
      }
    }
  }
}

const broken = [];

for (const sourceFile of markdownFiles) {
  const content = readFileSync(join(repoRoot, sourceFile), "utf-8");
  const lines = content.split("\n");
  let inFence = false;

  for (const [lineIndex, line] of lines.entries()) {
    if (line.includes(SKIP_LINE_MARKER)) continue;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    for (const link of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = link[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      if (!targetExists(sourceFile, target)) {
        broken.push({ sourceFile, line: lineIndex + 1, target });
      }
    }

    for (const span of line.matchAll(/`([^`]+)`/g)) {
      const candidate = span[1];
      const isPath = looksLikePathWithExtension(candidate);
      const isDir = looksLikeAllowedDirectory(candidate);
      if (!isPath && !isDir) continue;
      if (!targetExists(sourceFile, candidate)) {
        broken.push({ sourceFile, line: lineIndex + 1, target: candidate });
      }
    }
  }

  extractFromFrontmatterSources(content, broken, sourceFile);
}

if (broken.length > 0) {
  const seen = new Set();
  console.error(`Broken references (${broken.length}):`);
  for (const { sourceFile, line, target } of broken) {
    const key = `${sourceFile}:${line}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`  ${sourceFile}:${line}${line === 0 ? " (frontmatter)" : ""} -> ${target}`);
  }
  process.exit(1);
}

console.log(`docs link check passed (${markdownFiles.length} files scanned)`);
