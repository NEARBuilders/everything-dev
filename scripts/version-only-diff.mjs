// Decides whether a git diff is "release-mechanical only" — exactly what
// `changesets version` + the release train's post-version steps produce for
// a version-packages PR. Exit 0 = safe to skip the full CI matrix; exit 1 =
// the diff carries anything else (dependency bumps in a hand-edited
// package.json, scaffold code, anything outside the allowlist) and the
// caller must fall through to the real detect-changes arms.
//
// Usage: node scripts/version-only-diff.mjs <base-ref> <head-ref>
//
// Allowed, per changed package.json: version-field lines and internal
// dependency range lines for the three framework packages (changesets
// bumps `updateInternalDependencies: patch` ranges). Everything else is
// disallowed; non-package.json files come from the file allowlist
// (CHANGELOGs, .changeset/**, lockfile + workspace catalog, and the
// generated v2-catalog scaffold baseline).
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT =
  process.env.VERSION_DIFF_REPO_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");

const FILE_ALLOWLIST = [
  "^(package\\.json|pnpm-lock\\.yaml|pnpm-workspace\\.yaml)$",
  "^\\.changeset/",
  "^packages/[^/]+/CHANGELOG\\.md$",
  "^packages/everything-dev/src/services/scaffold/upgrade-audit/steps/v2-catalog\\.ts$",
];

const PACKAGE_JSON_LINE = /^\s*"(version|every-plugin|everything-dev|better-near-auth)":/;

function isPackageJsonFile(file) {
  return (
    file === "package.json" || (file.startsWith("packages/") && file.endsWith("/package.json"))
  );
}

function hunkAllowed(file, allowlist) {
  return isPackageJsonFile(file) || allowlist.some((pattern) => new RegExp(pattern).test(file));
}

export function git(args) {
  return execFileSync("git", args, { encoding: "utf8", cwd: REPO_ROOT });
}

export function isReleaseMechanicalDiff(base, head) {
  const diff = git(["diff", "--name-only", "--no-renames", `${base}..${head}`]).trim();
  if (!diff) return { ok: true };

  const files = diff.split("\n");
  const outside = files.filter((file) => !hunkAllowed(file, FILE_ALLOWLIST));
  if (outside.length > 0) {
    return {
      ok: false,
      reason: "files outside the release-mechanical allowlist",
      files: outside,
    };
  }

  const packageJsonFiles = files.filter(isPackageJsonFile);
  const rejected = scanPackageJsonDiffs(base, head, packageJsonFiles);
  if (rejected.length > 0) {
    return {
      ok: false,
      reason: "package.json lines that are not version or internal-version-range changes",
      files: rejected,
    };
  }
  return { ok: true };
}

function scanPackageJsonDiffs(base, head, files) {
  const rejected = [];
  for (const file of files) {
    const patch = git(["diff", "--no-renames", `${base}..${head}`, "--", file]);
    for (const line of patch.split("\n")) {
      if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
      if (!line.startsWith("+") && !line.startsWith("-")) continue;
      const content = line.slice(1);
      if (!PACKAGE_JSON_LINE.test(content)) {
        rejected.push(file);
        console.error(`  ! ${file}: disallowed changed line: ${content.trim()}`);
        break;
      }
    }
  }
  return rejected;
}

const [, , base = "origin/main", head = "HEAD"] = process.argv;
const verdict = isReleaseMechanicalDiff(base, head);
if (!verdict.ok) {
  console.error(`version-only-diff: refusing — ${verdict.reason}:`);
  for (const entry of verdict.files) console.error(`  ${entry}`);
  process.exit(1);
}
