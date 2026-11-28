import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * The legacy-terminology ban gate (#730, the artifact-control drift-guard
 * precedent): the registry-primitive sprint renamed the slot/pin/platform-
 * manifest vocabulary across the repo (ADR 0040); this gate fails CI the day
 * a retired identifier or compound term reappears in tracked surface code.
 * Substring matching is deliberate — it catches camelCase compounds a
 * word-boundary match would wave through. Historical records stay exempt
 * (docs/adr, CHANGELOG, .changeset, .scratch).
 */
const BANNED_TERMS = [
  "ConfigSlot",
  "walkConfigSlots",
  "SlotPinRef",
  "ReleaseSlotRecord",
  "PlatformReleaseManifest",
  "PlatformManifestService",
  "getPlatformManifestKey",
  "getPlatformVersionSlotKey",
  "parseBosUrl",
  "stampPlatformPin",
  "applyPlatformPin",
  "releasePlane",
  "auditReleasePlane",
  "EntrySlot",
  "SlotResolver",
  "AuthSlotShape",
  "everything-dev/fastkv",
  "platform.json",
  "platform-versions/",
  "waitForPublishConfirmation",
  "bos platform manifest",
] as const;

const SCOPE_GLOBS = [
  "packages/everything-dev/src/**",
  "host/src/**",
  "ui/src/**",
  "api/src/**",
  "plugins/*/src/**",
  "packages/everything-dev/skills/**",
  "tests/**",
  "docs/agents/**",
];

const SCOPE_FILES = ["GLOSSARY.md", "AGENTS.md"];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".scss",
  ".html",
  ".sh",
  ".go",
  ".txt",
]);

const EXEMPT_SEGMENTS = new Set([
  "node_modules",
  "dist",
  ".bos",
  ".changeset",
  ".scratch",
  "test-results",
  "playwright-report",
]);

function exempt(relativePath: string): boolean {
  const segments = relativePath.split("/");
  if (segments.some((segment) => EXEMPT_SEGMENTS.has(segment))) return true;
  if (segments.some((segment) => segment.startsWith("CHANGELOG"))) return true;
  if (relativePath.startsWith("docs/adr/")) return true;
  return false;
}

function offendersIn(content: string, relativePath: string): string[] {
  const offenders: string[] = [];
  const lines = content.split("\n");
  for (const term of BANNED_TERMS) {
    if (relativePath.includes(term)) {
      offenders.push(`${relativePath}: path names the banned term "${term}"`);
    }
    lines.forEach((line, index) => {
      if (line.includes(term)) offenders.push(`${relativePath}:${index + 1}: "${term}"`);
    });
  }
  return offenders;
}

describe("legacy-terminology ban gate", () => {
  it("keeps retired slot/pin/platform-manifest terms out of tracked surface code", () => {
    const scoped = [
      ...SCOPE_GLOBS.flatMap((pattern) =>
        glob.sync(pattern, { cwd: repoRoot, nodir: true, dot: true, posix: true }),
      ),
      ...SCOPE_FILES,
    ];
    const offenders = scoped
      .filter((relativePath) => !exempt(relativePath) && TEXT_EXTENSIONS.has(extname(relativePath)))
      .sort()
      .flatMap((relativePath) =>
        offendersIn(readFileSync(join(repoRoot, relativePath), "utf8"), relativePath),
      );
    expect(
      offenders,
      "retired registry vocabulary reappeared in tracked surface code — rename it to the ADR 0040 vocabulary (remote, record, manifest tag); see issue #730",
    ).toEqual([]);
  });
});
