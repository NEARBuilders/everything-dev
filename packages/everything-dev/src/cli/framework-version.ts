import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface FrameworkPackageResolution {
  specifier?: string;
  installedVersion?: string;
  isLinked: boolean;
  isWorkspaceLike: boolean;
}

function stripVersionPrefix(version: string): string {
  return version.replace(/^[\^~>=]+/, "");
}

export function readRootCatalogVersion(
  projectDir: string,
  packageName: string,
): string | undefined {
  const pkgPath = join(projectDir, "package.json");
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
  const pkgPath = join(projectDir, "node_modules", packageName, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
  return pkg.version;
}

function readSpecifier(
  pkg: Record<string, unknown>,
  packageName: string,
): string | undefined {
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  const peerDeps = (pkg.peerDependencies ?? {}) as Record<string, string>;
  return deps[packageName] || devDeps[packageName] || peerDeps[packageName];
}

export function resolveFrameworkPackage(
  projectDir: string,
  packageName: string,
): FrameworkPackageResolution {
  const pkgPath = join(projectDir, "package.json");
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
