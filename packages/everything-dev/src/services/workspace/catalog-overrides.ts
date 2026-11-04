import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { compareSemver } from "../../utils/semver";

/** The pnpm pin stamped into every generated and migrated child workspace.
 * Drift-guarded against the parent's own `packageManager` pin by
 * tests/unit/pnpm-pin.test.ts. */
export const PNPM_PACKAGE_MANAGER = "pnpm@12.16.1";

/**
 * Workspace keys whose `overrides:` row must equal the catalog row. An
 * override that re-pins a version literal drifts the moment the catalog
 * moves (#659/#682): the next build resolves the old version while the
 * upgrade reports success, and the #546 skew gate fails with a message
 * pointing at the wrong fix. Reconciliation (init, sync, upgrade) rewrites
 * these rows from the catalog on every run; keys absent from the catalog are
 * left unpinned.
 */
export const CATALOG_PINNED_OVERRIDE_KEYS = [
  "@better-fetch/fetch",
  "@rspack/core",
  "@tanstack/react-router",
  "@tanstack/router-core",
  "better-auth",
  "react",
  "react-dom",
] as const;

/**
 * Framework packages children install from the registry. A freshly released
 * version is younger than pnpm's `minimumReleaseAge` holdback (1440 default),
 * so each current version is excluded by exact `name@version` — derived from
 * the catalog on every write, never frozen. `minimumReleaseAgeExcludePrune`
 * makes pnpm drop entries the lockfile no longer resolves, so the list
 * replaces instead of accumulating (#659's append trap).
 */
export const FRAMEWORK_EXCLUDE_PACKAGES = [
  "better-near-auth",
  "every-plugin",
  "everything-dev",
] as const;

export interface WorkspaceYamlDoc {
  catalog?: Record<string, string>;
  overrides?: Record<string, string>;
  minimumReleaseAgeExclude?: string[];
  minimumReleaseAgeExcludePrune?: boolean;
  [key: string]: unknown;
}

const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * pnpm's minimumReleaseAgeExclude accepts exact versions only — a range like
 * `everything-dev@^2.0.0-rc.27` is a hard config error ("Use exact versions
 * only") that fails every install. The catalog's framework rows are ranges;
 * strip the operator. A specifier that doesn't reduce to an exact version is
 * skipped rather than emitted invalid.
 */
export function exactReleaseAgeExclude(name: string, specifier: string): string | undefined {
  const exact = specifier
    .trim()
    .replace(/^[~^=]+/, "")
    .trim();
  return EXACT_VERSION_RE.test(exact) ? `${name}@${exact}` : undefined;
}

export function frameworkReleaseAgeExcludes(catalog: Record<string, string>): string[] {
  return FRAMEWORK_EXCLUDE_PACKAGES.flatMap((name) => {
    const specifier = catalog[name];
    if (!specifier) return [];
    const entry = exactReleaseAgeExclude(name, specifier);
    return entry ? [entry] : [];
  });
}

/**
 * Pre-install invariant: the workspace's `minimumReleaseAgeExclude` rows must
 * cover every exact framework catalog row — a freshly released version
 * younger than pnpm's holdback fails the install otherwise (the Nov-03
 * stranded-rc incident). Returns the uncovered `name@version` rows; empty
 * when covered (or when the catalog carries no exact framework rows).
 */
export function releaseAgeExcludesCoverageGaps(doc: WorkspaceYamlDoc): string[] {
  const excludes = new Set(doc.minimumReleaseAgeExclude ?? []);
  return frameworkReleaseAgeExcludes(doc.catalog ?? {}).filter((entry) => !excludes.has(entry));
}

/**
 * File-level pre-install invariant: reads pnpm-workspace.yaml and returns the
 * uncovered release-age exclude rows. Unparseable or catalog-less files yield
 * no gaps (nothing to cover); reconciliation is what repairs real gaps.
 */
export function verifyReleaseAgeExcludes(root: string): string[] {
  const yamlPath = join(root, "pnpm-workspace.yaml");
  if (!existsSync(yamlPath)) return [];

  let doc: WorkspaceYamlDoc;
  try {
    const parsed = parse(readFileSync(yamlPath, "utf8")) as WorkspaceYamlDoc | null;
    if (!parsed || typeof parsed !== "object") return [];
    doc = parsed;
  } catch {
    return [];
  }

  return releaseAgeExcludesCoverageGaps(doc);
}

/**
 * Mutates the parsed workspace doc: overrides for the catalog-pinned keys
 * follow the catalog rows, framework release-age excludes are regenerated
 * from the catalog's current framework versions (non-framework entries the
 * child authored are preserved), and the prune flag is set. Returns whether
 * anything changed.
 */
export function reconcileWorkspacePosture(doc: WorkspaceYamlDoc): boolean {
  let changed = false;
  const catalog = doc.catalog ?? {};

  const overrides: Record<string, string> = { ...doc.overrides };
  let overridesChanged = false;
  for (const key of CATALOG_PINNED_OVERRIDE_KEYS) {
    if (catalog[key] && overrides[key] !== catalog[key]) {
      overrides[key] = catalog[key];
      overridesChanged = true;
    }
  }
  if (overridesChanged) {
    doc.overrides = Object.fromEntries(
      Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)),
    );
    changed = true;
  }

  const excludes = frameworkReleaseAgeExcludes(catalog);
  if (excludes.length > 0) {
    const retained = (doc.minimumReleaseAgeExclude ?? []).filter(
      (entry) => !FRAMEWORK_EXCLUDE_PACKAGES.some((name) => entry.startsWith(`${name}@`)),
    );
    const merged = [...new Set([...retained, ...excludes])].sort();
    if (JSON.stringify(merged) !== JSON.stringify(doc.minimumReleaseAgeExclude ?? [])) {
      doc.minimumReleaseAgeExclude = merged;
      changed = true;
    }
    if (doc.minimumReleaseAgeExcludePrune !== true) {
      doc.minimumReleaseAgeExcludePrune = true;
      changed = true;
    }
  }

  return changed;
}

/**
 * File-level reconciliation for an existing child workspace: reads
 * pnpm-workspace.yaml, applies `reconcileWorkspacePosture`, writes back only
 * on change. Catalog-sync callers run this after writing new catalog rows so
 * the child's overrides and release-age excludes land with the versions they
 * must agree with.
 */
export function reconcileWorkspaceYamlFile(root: string): boolean {
  const yamlPath = join(root, "pnpm-workspace.yaml");
  if (!existsSync(yamlPath)) return false;

  let doc: WorkspaceYamlDoc;
  try {
    const parsed = parse(readFileSync(yamlPath, "utf8")) as WorkspaceYamlDoc | null;
    if (!parsed || typeof parsed !== "object") return false;
    doc = parsed;
  } catch {
    return false;
  }
  if (!doc.catalog) return false;

  if (!reconcileWorkspacePosture(doc)) return false;
  writeFileSync(yamlPath, `${stringify(doc, { lineWidth: 0 }).trimEnd()}\n`);
  return true;
}

/**
 * Forward-only pnpm pin propagation for existing children: `migrate-pnpm` is
 * a one-time v1→v2 step and `bos init` only writes new projects, so without
 * this a parent toolchain bump never reaches already-v2 workspaces. Never
 * downgrades (a child pinning newer than the parent keeps its pin) and never
 * touches non-pnpm managers (the bun cutover is migrate-pnpm's job).
 */
export function reconcilePackageManagerPin(pkgPath: string): boolean {
  if (!existsSync(pkgPath)) return false;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }

  const current = typeof pkg.packageManager === "string" ? pkg.packageManager : undefined;
  if (current !== undefined && !current.startsWith("pnpm@")) return false;

  const currentVersion = current?.slice("pnpm@".length).split("+")[0];
  const targetVersion = PNPM_PACKAGE_MANAGER.slice("pnpm@".length).split("+")[0];
  if (currentVersion !== undefined && compareSemver(currentVersion, targetVersion) >= 0) {
    return false;
  }

  pkg.packageManager = PNPM_PACKAGE_MANAGER;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return true;
}
