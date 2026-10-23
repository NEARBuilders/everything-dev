import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { glob } from "glob";
import { readAuthoredConfigInput } from "../../config";
import { getExtendsRef } from "../../utils/bos-ref";
import { readJsonFile } from "../../utils/json-file";
import { readInstalledFrameworkVersion } from "../framework-version";
import { readWorkspaceCatalog, writeWorkspaceCatalog } from "../workspace/catalog";
import { findWorkspaceRoot } from "../workspace/workspace";
import { buildChildRootScripts, getParentOnlyScriptKeys } from "./init";

export const FRAMEWORK_PACKAGES = ["everything-dev", "every-plugin"];
export const AUTH_CORE_PACKAGE = "@better-auth/core";
export const AUTH_CORE_TRIGGER_PACKAGES = [
  "better-auth",
  "better-near-auth",
  "@better-auth/api-key",
  "@better-auth/passkey",
] as const;

export function workspaceDirOf(projectDir: string): string {
  return findWorkspaceRoot(projectDir)?.dir ?? projectDir;
}

export function readRootPackageJson(projectDir: string): Record<string, unknown> {
  return readJsonFile<Record<string, unknown>>(join(workspaceDirOf(projectDir), "package.json"));
}

export function readRootCatalogEntry(projectDir: string, packageName: string): string | undefined {
  return readWorkspaceCatalog(workspaceDirOf(projectDir))[packageName];
}

/**
 * Chain-catalog vs local-catalog diff for the drift alarm (ADR 0034 pt 6):
 * entries only count when the local catalog actually pins a different version
 * (`from !== undefined`) — a purely-additive chain entry the child does not
 * consume is not drift. Reading the local catalog is `readWorkspaceCatalog`
 * (pnpm-workspace.yaml first, package.json fallback) — the v1 package.json-only
 * read made every entry read as new on v2 children, a permanent false positive.
 */
export function diffCatalogEntries(
  sourceRootCatalog: Record<string, string>,
  currentCatalogEntries: Record<string, string>,
): Array<{ name: string; from: string | undefined; to: string }> {
  const updates: Array<{ name: string; from: string | undefined; to: string }> = [];
  for (const [name, targetVersion] of Object.entries(sourceRootCatalog)) {
    if (FRAMEWORK_PACKAGES.includes(name)) continue;
    const currentVersion = currentCatalogEntries[name];
    if (currentVersion === targetVersion) continue;
    updates.push({ name, from: currentVersion, to: targetVersion });
  }
  return updates;
}

export function readCurrentPackageSpecifier(
  projectDir: string,
  packageName: string,
): string | undefined {
  const pkg = readRootPackageJson(projectDir);

  for (const fieldName of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const field = pkg[fieldName] as Record<string, string> | undefined;
    const value = field?.[packageName];
    if (!value) continue;

    if (value === "catalog:") {
      return (
        readRootCatalogEntry(projectDir, packageName) ??
        readInstalledVersion(projectDir, packageName)
      );
    }

    if (value.startsWith("workspace:") || value.startsWith("file:") || value.startsWith("link:")) {
      return readInstalledVersion(projectDir, packageName);
    }

    return value;
  }

  return (
    readRootCatalogEntry(projectDir, packageName) ?? readInstalledVersion(projectDir, packageName)
  );
}

function setCatalogRefs(
  field: Record<string, string> | undefined,
  packageNames: ReadonlyArray<string>,
): boolean {
  if (!field) return false;

  let modified = false;
  for (const packageName of packageNames) {
    if (setCatalogRef(field, packageName)) {
      modified = true;
    }
  }

  return modified;
}

function syncPackageObjectCatalogRefs(
  pkg: Record<string, unknown>,
  packageNames: ReadonlyArray<string>,
): boolean {
  let modified = false;

  for (const fieldName of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const field = pkg[fieldName] as Record<string, string> | undefined;
    if (setCatalogRefs(field, packageNames)) {
      modified = true;
    }
  }

  return modified;
}

function findPackageFieldWithAnyDependency(
  pkg: Record<string, unknown>,
  packageNames: ReadonlyArray<string>,
): Record<string, string> | undefined {
  for (const fieldName of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const field = pkg[fieldName] as Record<string, string> | undefined;
    if (!field) continue;
    if (packageNames.some((packageName) => typeof field[packageName] === "string")) {
      return field;
    }
  }

  return undefined;
}

export function packageObjectNeedsAuthCoreCatalogRef(pkg: Record<string, unknown>): boolean {
  const targetField = findPackageFieldWithAnyDependency(pkg, AUTH_CORE_TRIGGER_PACKAGES);
  if (!targetField) return false;

  for (const fieldName of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const field = pkg[fieldName] as Record<string, string> | undefined;
    if (field?.[AUTH_CORE_PACKAGE]) return false;
  }

  return true;
}

export function ensureAuthCoreCatalogRef(pkg: Record<string, unknown>): boolean {
  if (!packageObjectNeedsAuthCoreCatalogRef(pkg)) return false;

  const targetField = findPackageFieldWithAnyDependency(pkg, AUTH_CORE_TRIGGER_PACKAGES);
  if (!targetField) return false;

  targetField[AUTH_CORE_PACKAGE] = "catalog:";
  return true;
}

export function packageObjectNeedsCatalogRefs(
  pkg: Record<string, unknown>,
  packageNames: ReadonlyArray<string>,
): boolean {
  for (const fieldName of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const field = pkg[fieldName] as Record<string, string> | undefined;
    if (!field) continue;

    for (const packageName of packageNames) {
      const value = field[packageName];
      if (!value) continue;
      if (value !== "catalog:" && !value.startsWith("file:") && !value.startsWith("link:")) {
        return true;
      }
    }
  }

  return false;
}

export function packageFileNeedsCatalogRefs(
  filePath: string,
  packageNames: ReadonlyArray<string>,
): boolean {
  return packageObjectNeedsCatalogRefs(
    readJsonFile<Record<string, unknown>>(filePath),
    packageNames,
  );
}

export function updatePackageFileCatalogRefs(
  filePath: string,
  packageNames: ReadonlyArray<string>,
): boolean {
  const pkg = readJsonFile<Record<string, unknown>>(filePath);
  const modified = syncPackageObjectCatalogRefs(pkg, packageNames);

  if (modified) {
    writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return modified;
}

export function updatePackageFileAuthCoreRef(filePath: string): boolean {
  const pkg = readJsonFile<Record<string, unknown>>(filePath);
  const modified = ensureAuthCoreCatalogRef(pkg);

  if (modified) {
    writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return modified;
}

export function syncRootCatalogWithParent(
  projectDir: string,
  parentCatalog: Record<string, string>,
): boolean {
  const workspaceDir = workspaceDirOf(projectDir);
  const pkgPath = join(workspaceDir, "package.json");
  const pkg = readJsonFile<Record<string, unknown>>(pkgPath);
  const modified = syncPackageObjectCatalogRefs(pkg, Object.keys(parentCatalog));

  let catalogChanged = false;
  const catalog = readWorkspaceCatalog(workspaceDir);
  for (const [packageName, version] of Object.entries(parentCatalog)) {
    if (catalog[packageName] !== version) {
      catalog[packageName] = version;
      catalogChanged = true;
    }
  }
  if (catalogChanged) {
    writeWorkspaceCatalog(workspaceDir, catalog);
  }

  if (modified) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return modified || catalogChanged;
}

export function readInstalledVersion(projectDir: string, packageName: string): string | undefined {
  return readInstalledFrameworkVersion(projectDir, packageName);
}

export function setCatalogRef(
  field: Record<string, string> | undefined,
  packageName: string,
): boolean {
  if (!field || !(packageName in field)) return false;
  if (field[packageName] === "catalog:" || field[packageName].startsWith("file:")) return false;
  field[packageName] = "catalog:";
  return true;
}

export async function findWorkspacePackageJsons(projectDir: string): Promise<string[]> {
  const root = findWorkspaceRoot(projectDir);
  if (!root) return [];

  const pkgPaths: string[] = [];
  for (const member of root.members) {
    const pkgPath = join(member.dir, "package.json");
    if (existsSync(pkgPath) && statSync(pkgPath).isFile()) {
      pkgPaths.push(pkgPath);
    }
  }

  return [...new Set(pkgPaths)];
}

export async function migrateChildRootPackageJson(projectDir: string): Promise<boolean> {
  const config = (await readAuthoredConfigInput(projectDir)) as Record<string, unknown> | null;
  const pkgPath = join(workspaceDirOf(projectDir), "package.json");
  if (!config || !existsSync(pkgPath)) {
    return false;
  }

  const extendsRef = getExtendsRef(config);
  if (!extendsRef?.startsWith("bos://")) {
    return false;
  }

  const pkg = readJsonFile<Record<string, unknown>>(pkgPath);
  let changed = false;

  if (pkg.private !== true) {
    pkg.private = true;
    changed = true;
  }
  if (pkg.type !== "module") {
    pkg.type = "module";
    changed = true;
  }
  if ("module" in pkg) {
    delete pkg.module;
    changed = true;
  }

  const pluginPackageJsons = await glob("plugins/*/package.json", {
    cwd: projectDir,
    nodir: true,
    dot: false,
    absolute: false,
  });
  const childScripts = buildChildRootScripts({
    ui: existsSync(join(projectDir, "ui", "package.json")),
    api: existsSync(join(projectDir, "api", "package.json")),
    host: existsSync(join(projectDir, "host", "package.json")),
    plugins: pluginPackageJsons.length > 0,
  });

  if (!pkg.scripts || typeof pkg.scripts !== "object") {
    pkg.scripts = {};
    changed = true;
  }
  const scripts = pkg.scripts as Record<string, string>;
  for (const [key, value] of Object.entries(childScripts)) {
    if (scripts[key] !== value) {
      scripts[key] = value;
      changed = true;
    }
  }
  for (const obsoleteScript of [...getParentOnlyScriptKeys(projectDir), "sync-catalog", "init"]) {
    if (obsoleteScript in scripts) {
      delete scripts[obsoleteScript];
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return changed;
}
