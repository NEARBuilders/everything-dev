import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { glob } from "glob";
import { readWorkspaceCatalog } from "../workspace-catalog";

const FRAMEWORK_PACKAGES = ["every-plugin", "everything-dev"] as const;

const CATALOG_TOOL_PACKAGES = [
  "@rspack/core",
  "@rspack/cli",
  "@rsbuild/core",
  "@rsbuild/plugin-react",
  "@module-federation/enhanced",
  "@module-federation/node",
  "@module-federation/rsbuild-plugin",
  "@module-federation/runtime-core",
  "@module-federation/sdk",
  "@module-federation/dts-plugin",
] as const;

type PackageJson = Record<string, unknown>;

type NormalizationSpec = {
  rootCatalog: Record<string, string>;
  frameworkVersions: Record<string, string>;
};

type NormalizeManifestOptions = {
  resolveCatalogRefs: boolean;
  preserveCatalogRefs?: boolean;
  excludeFrameworkWorkspaces?: boolean;
  removeWorkspaceDeps?: string[];
  removeWorkspaces?: boolean;
  removePublishScripts?: boolean;
};

export type NormalizeTreeOptions = NormalizeManifestOptions & {
  sourceRootDir: string;
  targetDir: string;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function extractExactVersion(input: string | undefined): string | null {
  if (!input) return null;
  const match = input.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match ? match[0] : null;
}

function writeJson(filePath: string, value: PackageJson) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function loadManifestNormalizationSpec(sourceRootDir: string): NormalizationSpec {
  const rootCatalog = readWorkspaceCatalog(sourceRootDir);
  const frameworkVersions: Record<string, string> = {};

  for (const packageName of FRAMEWORK_PACKAGES) {
    const sourcePackagePath = join(sourceRootDir, "packages", packageName, "package.json");
    const localPackagePath = join(import.meta.dirname, "..", "..", packageName, "package.json");
    const packageVersion = existsSync(localPackagePath)
      ? readJson<{ version: string }>(localPackagePath).version
      : existsSync(sourcePackagePath)
        ? readJson<{ version: string }>(sourcePackagePath).version
        : extractExactVersion(rootCatalog[packageName]);

    if (!packageVersion) {
      throw new Error(`Could not resolve version for ${packageName}`);
    }

    frameworkVersions[packageName] = packageVersion;
    rootCatalog[packageName] = `^${packageVersion}`;
  }

  return { rootCatalog, frameworkVersions };
}

function normalizeDependencyMap(
  map: Record<string, string>,
  spec: NormalizationSpec,
  options: NormalizeManifestOptions,
) {
  const catalogPackages = new Set<string>([...FRAMEWORK_PACKAGES, ...CATALOG_TOOL_PACKAGES]);

  let modified = false;

  for (const [name, version] of Object.entries(map)) {
    if (options.preserveCatalogRefs && catalogPackages.has(name)) {
      if (version !== "catalog:") {
        map[name] = "catalog:";
        modified = true;
      }
      continue;
    }

    if (version.startsWith("workspace:")) {
      const frameworkVersion = spec.frameworkVersions[name];
      if (frameworkVersion) {
        map[name] = `^${frameworkVersion}`;
        modified = true;
        continue;
      }

      if (options.removeWorkspaceDeps?.includes(name)) {
        delete map[name];
        modified = true;
        continue;
      }

      // A workspace dep on a non-framework member (e.g. better-near-auth)
      // cannot resolve in a generated child — the member does not exist
      // there. Children keep the catalog: protocol (the catalog pins the
      // published version); release staging resolves the real range.
      if (spec.rootCatalog[name]) {
        map[name] = options.preserveCatalogRefs ? "catalog:" : spec.rootCatalog[name];
        modified = true;
      }
      continue;
    }

    if (options.resolveCatalogRefs && version.startsWith("catalog:")) {
      const resolved = spec.rootCatalog[name];
      if (resolved) {
        map[name] = resolved;
        modified = true;
      }
    }
  }

  return modified;
}

export function normalizePackageManifest(
  pkg: PackageJson,
  spec: NormalizationSpec,
  options: NormalizeManifestOptions,
) {
  let modified = false;

  for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[depField];
    if (!deps || typeof deps !== "object") continue;
    if (normalizeDependencyMap(deps as Record<string, string>, spec, options)) {
      modified = true;
    }
  }

  if (pkg.workspaces && typeof pkg.workspaces === "object") {
    const workspaces = pkg.workspaces as {
      packages?: string[];
      catalog?: Record<string, string>;
    };

    if (options.excludeFrameworkWorkspaces && Array.isArray(workspaces.packages)) {
      const nextPackages = workspaces.packages.filter(
        (entry) => !FRAMEWORK_PACKAGES.some((name) => entry === `packages/${name}`),
      );
      if (nextPackages.length !== workspaces.packages.length) {
        workspaces.packages = nextPackages;
        modified = true;
      }
    }

    if (workspaces.catalog && typeof workspaces.catalog === "object") {
      for (const [name, version] of Object.entries(workspaces.catalog)) {
        const resolved = spec.rootCatalog[name];
        if (resolved && resolved !== version) {
          workspaces.catalog[name] = resolved;
          modified = true;
          continue;
        }

        if (version === "workspace:*" && spec.frameworkVersions[name]) {
          workspaces.catalog[name] = `^${spec.frameworkVersions[name]}`;
          modified = true;
        }
      }
    }
  }

  if (options.removeWorkspaces && "workspaces" in pkg) {
    delete pkg.workspaces;
    modified = true;
  }

  if (options.removePublishScripts && pkg.scripts && typeof pkg.scripts === "object") {
    const scripts = pkg.scripts as Record<string, string>;
    let scriptsModified = false;
    for (const key of ["prepublishOnly", "prepack", "prepare", "postpack"]) {
      if (key in scripts) {
        delete scripts[key];
        scriptsModified = true;
      }
    }
    if (scriptsModified) {
      modified = true;
      if (Object.keys(scripts).length === 0) {
        delete pkg.scripts;
      }
    }
  }

  return modified;
}

export async function normalizePackageManifestsInTree(opts: NormalizeTreeOptions) {
  const spec = loadManifestNormalizationSpec(opts.sourceRootDir);
  const files = await glob("**/package.json", {
    cwd: opts.targetDir,
    nodir: true,
    dot: false,
    absolute: true,
    ignore: ["**/node_modules/**"],
  });

  const updatedFiles: string[] = [];

  for (const filePath of files) {
    const pkg = readJson<PackageJson>(filePath);
    if (normalizePackageManifest(pkg, spec, opts)) {
      writeJson(filePath, pkg);
      updatedFiles.push(filePath);
    }
  }

  return updatedFiles;
}

function shouldCopyPackageFile(sourceDir: string, filePath: string) {
  const relPath = relative(sourceDir, filePath);
  if (!relPath) return true;
  const segments = relPath.split(sep);
  return !segments.includes("node_modules") && !segments.includes("tests");
}

function stripDevelopmentExports(pkg: PackageJson) {
  const exports = pkg.exports;
  if (!exports || typeof exports !== "object") return;

  for (const key of Object.keys(exports as Record<string, unknown>)) {
    const entry = (exports as Record<string, unknown>)[key];
    if (entry && typeof entry === "object") {
      delete (entry as Record<string, unknown>).development;
    }
  }
}

// A published package ships only dist/ — a bare src pointer left after the
// strip is a dangling path for npm consumers, so fail the release instead.
function assertNoSourceExports(pkg: PackageJson, packageName: string) {
  const exports = pkg.exports;
  if (!exports || typeof exports !== "object") return;

  const dangling: string[] = [];
  for (const [key, entry] of Object.entries(exports as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    for (const [condition, target] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof target === "string" && target.startsWith("./src/")) {
        dangling.push(`${key} (${condition}: ${target})`);
      }
    }
  }

  if (dangling.length > 0) {
    throw new Error(
      `${packageName}: exports still point at unpublished ./src/ paths after stripping ` +
        `development conditions. Map them to dist/ in the package manifest:\n` +
        dangling.map((entry) => `  - ${entry}`).join("\n"),
    );
  }
}

export function stageReleasePackage(opts: {
  repoRoot: string;
  packageName: string;
  outDir: string;
}) {
  const sourceDir = join(opts.repoRoot, "packages", opts.packageName);

  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(dirname(opts.outDir), { recursive: true });
  cpSync(sourceDir, opts.outDir, {
    recursive: true,
    filter: (filePath) => shouldCopyPackageFile(sourceDir, filePath),
  });
  rmSync(join(opts.outDir, "tests"), { recursive: true, force: true });

  const packageJsonPath = join(opts.outDir, "package.json");
  const spec = loadManifestNormalizationSpec(opts.repoRoot);
  const pkg = readJson<PackageJson>(packageJsonPath);

  normalizePackageManifest(pkg, spec, {
    resolveCatalogRefs: true,
    preserveCatalogRefs: false,
    removeWorkspaces: true,
    removePublishScripts: true,
  });

  stripDevelopmentExports(pkg);
  assertNoSourceExports(pkg, opts.packageName);

  writeJson(packageJsonPath, pkg);
}

export function stageReleasePackages(opts: {
  repoRoot: string;
  outDir: string;
  packageNames?: string[];
}) {
  const packageNames = opts.packageNames ?? [...FRAMEWORK_PACKAGES];
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(opts.outDir, { recursive: true });

  for (const packageName of packageNames) {
    stageReleasePackage({
      repoRoot: opts.repoRoot,
      packageName,
      outDir: join(opts.outDir, packageName),
    });
  }
}
