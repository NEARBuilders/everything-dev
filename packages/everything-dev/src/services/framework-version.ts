import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkspaceCatalog } from "./workspace/catalog";
import { findWorkspaceRoot } from "./workspace/workspace";

export interface FrameworkPackageResolution {
  specifier?: string;
  installedVersion?: string;
  isLinked: boolean;
  isWorkspaceLike: boolean;
}

function stripVersionPrefix(version: string): string {
  return version.replace(/^[\^~>=]+/, "");
}

function workspaceDirOf(projectDir: string): string {
  return findWorkspaceRoot(projectDir)?.dir ?? projectDir;
}

export function readRootCatalogVersion(
  projectDir: string,
  packageName: string,
): string | undefined {
  const root = workspaceDirOf(projectDir);
  // The catalog lives in pnpm-workspace.yaml on every current tree (pnpm 12
  // layout, what `bos init`/`bos sync` write and what the parent ships); the
  // package.json `workspaces.catalog` read below is the legacy fallback.
  const yamlCatalog = readWorkspaceCatalog(root)[packageName];
  if (yamlCatalog) return stripVersionPrefix(yamlCatalog);
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    workspaces?: { catalog?: Record<string, string> };
  };
  const version = pkg.workspaces?.catalog?.[packageName];
  return version ? stripVersionPrefix(version) : undefined;
}

export function readNodeModulesVersion(
  projectDir: string,
  packageName: string,
): string | undefined {
  const pkgPath = join(workspaceDirOf(projectDir), "node_modules", packageName, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
  return pkg.version;
}

function readSpecifier(pkg: Record<string, unknown>, packageName: string): string | undefined {
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  const peerDeps = (pkg.peerDependencies ?? {}) as Record<string, string>;
  return deps[packageName] || devDeps[packageName] || peerDeps[packageName];
}

export function resolveFrameworkPackage(
  projectDir: string,
  packageName: string,
): FrameworkPackageResolution {
  const pkgPath = join(workspaceDirOf(projectDir), "package.json");
  if (!existsSync(pkgPath)) {
    return { isLinked: false, isWorkspaceLike: false };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const specifier = readSpecifier(pkg, packageName);

  if (!specifier) {
    const catalog = readRootCatalogVersion(projectDir, packageName);
    const installed = catalog ?? readNodeModulesVersion(projectDir, packageName);
    return {
      specifier,
      installedVersion: installed,
      isLinked: false,
      isWorkspaceLike: false,
    };
  }

  if (specifier.startsWith("link:")) {
    return {
      specifier,
      installedVersion: readNodeModulesVersion(projectDir, packageName),
      isLinked: true,
      isWorkspaceLike: false,
    };
  }

  if (specifier.startsWith("workspace:") || specifier.startsWith("file:")) {
    return {
      specifier,
      installedVersion: readNodeModulesVersion(projectDir, packageName),
      isLinked: false,
      isWorkspaceLike: true,
    };
  }

  if (specifier === "catalog:") {
    const catalog = readRootCatalogVersion(projectDir, packageName);
    const installed = catalog ?? readNodeModulesVersion(projectDir, packageName);
    return {
      specifier,
      installedVersion: installed,
      isLinked: false,
      isWorkspaceLike: false,
    };
  }

  return {
    specifier,
    installedVersion: stripVersionPrefix(specifier),
    isLinked: false,
    isWorkspaceLike: false,
  };
}

export function readInstalledFrameworkVersion(
  projectDir: string,
  packageName: string,
): string | undefined {
  return resolveFrameworkPackage(projectDir, packageName).installedVersion;
}
