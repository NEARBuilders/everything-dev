import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface SkillVersionSync {
  file: string;
  from: string;
  to: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
const LIBRARY_VERSION_LINE = /^(\s*library_version:\s*")([^"]*)(")\s*$/;

function rewriteFrontmatterVersion(
  content: string,
  version: string,
): { content: string; from: string } | null {
  const frontmatter = content.match(FRONTMATTER_PATTERN);
  if (!frontmatter) return null;
  const body = content.slice(frontmatter[0].length);
  let from: string | null = null;
  const rewritten = frontmatter[1]
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(LIBRARY_VERSION_LINE);
      if (!match || match[2] === version) return line;
      from = match[2];
      return `${match[1]}${version}${match[3]}`;
    })
    .join("\n");
  return from === null ? null : { content: `---\n${rewritten}\n---${body}`, from };
}

/**
 * Rewrites every `library_version:` marker in the package's `skills/<skill>/SKILL.md`
 * frontmatter to the owning package's `package.json` version. Skills without a
 * marker are left alone — adding one is a maintainer decision, not a sync
 * side effect. Returns one entry per file it actually changed.
 */
export function syncSkillLibraryVersions(packageDir: string): SkillVersionSync[] {
  const pkgJsonPath = join(packageDir, "package.json");
  if (!existsSync(pkgJsonPath)) return [];
  let version: string | undefined;
  try {
    version = (JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version?: string }).version;
  } catch {
    return [];
  }
  if (!version) return [];

  const skillsDir = join(packageDir, "skills");
  if (!existsSync(skillsDir)) return [];

  const changed: SkillVersionSync[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const content = readFileSync(skillPath, "utf8");
    const rewritten = rewriteFrontmatterVersion(content, version);
    if (rewritten === null) continue;
    writeFileSync(skillPath, rewritten.content);
    changed.push({
      file: relative(packageDir, skillPath).split(sep).join("/"),
      from: rewritten.from,
      to: version,
    });
  }
  return changed;
}

/** Syncs every `packages/*` workspace member that owns skills. */
export function syncWorkspaceSkillLibraryVersions(root: string): SkillVersionSync[] {
  const packagesDir = join(root, "packages");
  if (!existsSync(packagesDir)) return [];
  const changed: SkillVersionSync[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    changed.push(...syncSkillLibraryVersions(join(packagesDir, entry.name)));
  }
  return changed;
}
