import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { glob } from "glob";
import { MISSING_CONFIG_MESSAGE, readAuthoredConfigInput } from "../../config";
import type { PhaseTiming, UpgradeOptions, UpgradeResult } from "../../contract";
import { getExtendsRef, parseBosRef } from "../../utils/bos-ref";
import { formatUnknownError } from "../../utils/errors";
import { readJsonFile } from "../../utils/json-file";
import { saveBosConfig } from "../../utils/save-config";
import { timePhase } from "../../utils/timing";
import { readInstalledFrameworkVersion } from "../framework-version";
import { type ResolvedPlatformManifest, resolvePlatformManifest } from "../platform/manifest";
import { openResolution } from "../resolution/session";
import { readWorkspaceCatalog, writeWorkspaceCatalog } from "../workspace/catalog";
import { syncResolvedSharedDeps } from "../workspace/shared-deps";
import { findWorkspaceRoot } from "../workspace/workspace";
import {
  buildChildRootScripts,
  fetchParentConfig,
  getParentOnlyScriptKeys,
  runPnpmInstallForUpgrade,
  runTypesGen,
} from "./init";
import { syncTemplate } from "./sync";

const FRAMEWORK_PACKAGES = ["everything-dev", "every-plugin"];
const AUTH_CORE_PACKAGE = "@better-auth/core";
const AUTH_CORE_TRIGGER_PACKAGES = [
  "better-auth",
  "better-near-auth",
  "@better-auth/api-key",
  "@better-auth/passkey",
] as const;
const UPSTREAM_ISSUE_URL = "https://github.com/NEARBuilders/everything-dev/issues";

interface ExtendedRootSource {
  catalog: Record<string, string>;
  repository?: string;
  extendsChain: string[];
  /** The resolved platform release manifest when one publishes (ADR 0034). */
  platform: ResolvedPlatformManifest;
}

function extractSemver(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

function workspaceDirOf(projectDir: string): string {
  return findWorkspaceRoot(projectDir)?.dir ?? projectDir;
}

function readRootPackageJson(projectDir: string): Record<string, unknown> {
  return readJsonFile<Record<string, unknown>>(join(workspaceDirOf(projectDir), "package.json"));
}

function readRootCatalogEntry(projectDir: string, packageName: string): string | undefined {
  return readWorkspaceCatalog(workspaceDirOf(projectDir))[packageName];
}

/**
 * The re-exec'd migration child runs `--json`, so its stdout is the structured
 * result — a failed run carries the real failure in its `error` field, which
 * raw stderr/stdout concatenation hides behind `[CLI] [object Object]`.
 */
export function describeMigrationFailure(
  stdout: string | undefined,
  stderr: string | undefined,
): string {
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout) as { error?: unknown };
      if (parsed && typeof parsed === "object" && parsed.error != null) {
        return formatUnknownError(parsed.error);
      }
    } catch {
      // not JSON — fall through to the raw streams
    }
  }
  const raw = (stderr || stdout || "").trim();
  return raw.length > 0 ? raw : "Unknown error";
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

function readCurrentPackageSpecifier(projectDir: string, packageName: string): string | undefined {
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

function packageObjectNeedsAuthCoreCatalogRef(pkg: Record<string, unknown>): boolean {
  const targetField = findPackageFieldWithAnyDependency(pkg, AUTH_CORE_TRIGGER_PACKAGES);
  if (!targetField) return false;

  for (const fieldName of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const field = pkg[fieldName] as Record<string, string> | undefined;
    if (field?.[AUTH_CORE_PACKAGE]) return false;
  }

  return true;
}

function ensureAuthCoreCatalogRef(pkg: Record<string, unknown>): boolean {
  if (!packageObjectNeedsAuthCoreCatalogRef(pkg)) return false;

  const targetField = findPackageFieldWithAnyDependency(pkg, AUTH_CORE_TRIGGER_PACKAGES);
  if (!targetField) return false;

  targetField[AUTH_CORE_PACKAGE] = "catalog:";
  return true;
}

function packageObjectNeedsCatalogRefs(
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

function packageFileNeedsCatalogRefs(
  filePath: string,
  packageNames: ReadonlyArray<string>,
): boolean {
  return packageObjectNeedsCatalogRefs(
    readJsonFile<Record<string, unknown>>(filePath),
    packageNames,
  );
}

function updatePackageFileCatalogRefs(
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

function updatePackageFileAuthCoreRef(filePath: string): boolean {
  const pkg = readJsonFile<Record<string, unknown>>(filePath);
  const modified = ensureAuthCoreCatalogRef(pkg);

  if (modified) {
    writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return modified;
}

function syncRootCatalogWithParent(
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

async function readExtendedRootSource(projectDir: string): Promise<ExtendedRootSource> {
  const localConfig = (await readAuthoredConfigInput(projectDir)) as Record<string, unknown> | null;
  if (!localConfig) {
    throw new Error("No authored config found in current directory");
  }

  let extendsRef = getExtendsRef(localConfig);
  if (!extendsRef?.startsWith("bos://")) {
    throw new Error(
      "No bos:// extends field found in the authored config — upgrade moves children that extend a deployed runtime",
    );
  }

  const extendsChain: string[] = [];
  const visited = new Set<string>();
  let repository = typeof localConfig.repository === "string" ? localConfig.repository : undefined;

  while (extendsRef?.startsWith("bos://")) {
    if (visited.has(extendsRef)) {
      throw new Error(`Circular extends detected while resolving upgrade source: ${extendsRef}`);
    }
    visited.add(extendsRef);
    extendsChain.push(extendsRef);

    const parsed = parseBosRef(extendsRef);
    if (!parsed) {
      break;
    }

    let parentConfig: Record<string, unknown>;
    try {
      parentConfig = (await fetchParentConfig(parsed.account, parsed.gateway)) as Record<
        string,
        unknown
      >;
    } catch {
      break;
    }

    if (typeof parentConfig.repository === "string") {
      repository = parentConfig.repository;
    }

    const nextExtendsRef = getExtendsRef(parentConfig);
    if (!nextExtendsRef?.startsWith("bos://")) {
      break;
    }

    extendsRef = nextExtendsRef;
  }

  // ADR 0034: the platform release manifest is the single upgrade authority —
  // its catalog and repository metadata. The upgrade-of-record resolves it
  // *ignoring the child's own platform pin*: the pin freezes everyday
  // resolution (sync, init, runtime); this is the pathway that moves the pin
  // to the latest chain release. No manifest anywhere → fail loud.
  const platform = await resolvePlatformManifest({
    configDir: projectDir,
    localConfig: { ...localConfig, platform: undefined },
  });
  if (!platform) {
    throw new Error(
      `No platform release manifest resolves in the extends chain (${extendsChain.join(" → ")}) — publish the platform manifest (bos publish on the parent) or run \`bos platform manifest --check\` to diagnose`,
    );
  }

  return {
    catalog: platform.manifest.catalog,
    repository,
    extendsChain,
    platform,
  };
}

/**
 * Stamp the resolved framework version into the authored config's `platform`
 * pin (ADR 0034). Runs at the top of the migration phase on both the inline
 * and re-exec'd paths, so everyday resolution (sync, init, runtime) always
 * freezes to the release this upgrade just landed from — whether or not the
 * package versions actually moved.
 */
async function applyPlatformPin(
  projectDir: string,
  parentSource: ExtendedRootSource,
): Promise<string | undefined> {
  const version = parentSource.platform.manifest.frameworkVersion;
  const config = (await readAuthoredConfigInput(projectDir)) as Record<string, unknown> | null;
  if (!config) return undefined;
  if (config.platform === version) return undefined;

  config.platform = version;
  await saveBosConfig(projectDir, config);
  return existsSync(join(projectDir, "bos.app.ts")) ? "bos.app.ts" : "bos.config.json";
}

async function loadParentPluginOptions(projectDir: string): Promise<{
  localConfig: Record<string, unknown>;
  parentPlugins: Record<string, unknown>;
  newPluginKeys: string[];
} | null> {
  const localConfig = (await readAuthoredConfigInput(projectDir)) as Record<string, unknown> | null;
  if (!localConfig) {
    return null;
  }
  const extendsRef = getExtendsRef(localConfig);
  if (!extendsRef?.startsWith("bos://")) {
    return null;
  }

  const parsed = parseBosRef(extendsRef);
  if (!parsed) {
    return null;
  }

  let parentConfig: Record<string, unknown>;
  try {
    parentConfig = await fetchParentConfig(parsed.account, parsed.gateway);
  } catch {
    return null;
  }

  const parentPlugins =
    parentConfig.plugins && typeof parentConfig.plugins === "object"
      ? (parentConfig.plugins as Record<string, unknown>)
      : {};
  const localPlugins =
    localConfig.plugins && typeof localConfig.plugins === "object"
      ? (localConfig.plugins as Record<string, unknown>)
      : {};

  const newPluginKeys = Object.keys(parentPlugins).filter((key) => !(key in localPlugins));
  return { localConfig, parentPlugins, newPluginKeys };
}

function readInstalledVersion(projectDir: string, packageName: string): string | undefined {
  return readInstalledFrameworkVersion(projectDir, packageName);
}

function setCatalogRef(field: Record<string, string> | undefined, packageName: string): boolean {
  if (!field || !(packageName in field)) return false;
  if (field[packageName] === "catalog:" || field[packageName].startsWith("file:")) return false;
  field[packageName] = "catalog:";
  return true;
}

async function findWorkspacePackageJsons(projectDir: string): Promise<string[]> {
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

function buildChangelogUrl(
  oldVersion: string | undefined,
  newVersion: string,
  repository: string | undefined,
): string | undefined {
  const fromVersion = extractSemver(oldVersion);
  const toVersion = extractSemver(newVersion);
  if (!fromVersion || !toVersion || fromVersion === toVersion) return undefined;

  const repoUrl = repository;
  if (!repoUrl) return undefined;

  const githubMatch = repoUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!githubMatch) return undefined;

  const [, owner, repo] = githubMatch;
  return `https://github.com/${owner}/${repo}/compare/v${fromVersion}...v${toVersion}`;
}

/** Migration-phase scope (ADR 0032): template reconciliation rides the
 * framework version delta — with no delta nothing touches the tree. */
interface MigrationScope {
  /** true when the upgrade moves framework versions (or `--from` says so) */
  versionDelta: boolean;
}

async function runMigrationPhase(
  projectDir: string,
  options: UpgradeOptions,
  parentSource: ExtendedRootSource,
  scope: MigrationScope,
): Promise<UpgradeResult> {
  const timings: PhaseTiming[] = [];

  const platformPinned = await timePhase(timings, "stamp platform pin", () =>
    applyPlatformPin(projectDir, parentSource),
  );

  const migratedRootPackageJson = await timePhase(timings, "migrate root package", () =>
    migrateChildRootPackageJson(projectDir),
  );

  let syncResult: UpgradeResult["sync"];
  // Same-version upgrades never touch framework-owned files (ADR 0032).
  // `--no-sync` opts out of a version-change sync.
  if (scope.versionDelta && !options.noSync) {
    syncResult = await timePhase(timings, "sync template", () =>
      syncTemplate(projectDir, {
        dryRun: false,
        noInstall: true,
        force: options.force,
      }),
    );
    if (syncResult?.status === "conflicted") {
      throw new Error(syncResult.error ?? "Template sync hit unresolvable local conflicts");
    }
  }

  await timePhase(timings, "sync shared deps", async () => {
    const configSession = await openResolution({ cwd: projectDir });
    if (!configSession?.config) {
      throw new Error(`${MISSING_CONFIG_MESSAGE} in current directory`);
    }

    return syncResolvedSharedDeps({
      configDir: projectDir,
      hostMode: "local",
      bosConfig: configSession.config,
    });
  });

  if (!options.noInstall) {
    await timePhase(timings, "generate types", () => runTypesGen(projectDir));
  }

  const migratedFiles = [
    ...(platformPinned ? [platformPinned] : []),
    ...(migratedRootPackageJson ? ["package.json"] : []),
  ];

  const mainPkg = parentSource.catalog["everything-dev"];
  const changelogUrl = mainPkg
    ? buildChangelogUrl(undefined, mainPkg, parentSource.repository)
    : undefined;

  return {
    status: "upgraded",
    packages: [],
    sync: syncResult,
    migrated: migratedFiles.length > 0 ? migratedFiles : undefined,
    timings,
    changelogUrl,
  };
}

export async function upgradeTemplate(
  projectDir: string,
  options: UpgradeOptions,
): Promise<UpgradeResult> {
  const timings: PhaseTiming[] = [];
  // `--check` is CI's drift alarm (ADR 0034 pt 6): dry-run semantics plus a
  // nonzero exit when updates are available (renderer-side).
  if (options.check) options.dryRun = true;
  const pkgPath = join(workspaceDirOf(projectDir), "package.json");
  if (!existsSync(pkgPath)) {
    return {
      status: "error",
      packages: [],
      timings,
      error: "No package.json found in current directory",
    };
  }

  const parentSource = await readExtendedRootSource(projectDir);
  const sourceRootCatalog = parentSource.catalog;
  const inheritedCatalogPackageNames = Object.keys(sourceRootCatalog);
  const currentCatalogEntries = readWorkspaceCatalog(workspaceDirOf(projectDir));
  const workspacePkgPaths = await findWorkspacePackageJsons(projectDir);
  const hasCatalogRefRewrites =
    inheritedCatalogPackageNames.length > 0 &&
    (packageObjectNeedsCatalogRefs(readRootPackageJson(projectDir), inheritedCatalogPackageNames) ||
      workspacePkgPaths.some((pkgPath) =>
        packageFileNeedsCatalogRefs(pkgPath, inheritedCatalogPackageNames),
      ));
  const hasAuthCoreRefRewrites =
    packageObjectNeedsAuthCoreCatalogRef(readRootPackageJson(projectDir)) ||
    workspacePkgPaths.some((pkgPath) =>
      packageObjectNeedsAuthCoreCatalogRef(readJsonFile<Record<string, unknown>>(pkgPath)),
    );

  const { packages, catalogVersionUpdates } = await timePhase(
    timings,
    "check package versions",
    async () => {
      const nextPackages: UpgradeResult["packages"] = [];

      for (const name of FRAMEWORK_PACKAGES) {
        const current = readCurrentPackageSpecifier(projectDir, name);
        const target = sourceRootCatalog[name] ?? current ?? "unknown";

        nextPackages.push({ name, from: current, to: target });
      }

      const nextCatalogVersionUpdates = diffCatalogEntries(
        sourceRootCatalog,
        currentCatalogEntries,
      );

      return { packages: nextPackages, catalogVersionUpdates: nextCatalogVersionUpdates };
    },
  );

  const hasFrameworkUpdates = packages.some((p) => p.from !== p.to && p.from !== undefined);
  const hasCatalogUpdates = catalogVersionUpdates.some((u) => u.from !== undefined);
  const hasUpdates =
    hasFrameworkUpdates || hasCatalogUpdates || hasCatalogRefRewrites || hasAuthCoreRefRewrites;

  if (options.dryRun) {
    let changelogUrl: string | undefined;
    const pluginOptions = options.noSync
      ? null
      : await timePhase(timings, "list parent plugins", () => loadParentPluginOptions(projectDir));
    if (hasUpdates) {
      const mainPkg = packages.find((p) => p.name === "everything-dev");
      if (mainPkg?.from && mainPkg.from !== mainPkg.to) {
        changelogUrl = buildChangelogUrl(mainPkg.from, mainPkg.to, parentSource.repository);
      }
    }

    return {
      status: "dry-run",
      packages: [
        ...packages,
        ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
      ],
      availablePlugins: pluginOptions?.newPluginKeys,
      platform: {
        resolved: parentSource.platform.manifest.frameworkVersion,
        source: `bos://${parentSource.platform.source.account}/${parentSource.platform.source.gateway}`,
        fromCache: parentSource.platform.fromCache,
      },
      updatesAvailable: hasUpdates,
      timings,
      changelogUrl,
    };
  }

  // The version delta that drives the whole migration phase. In the re-exec'd
  // child, packages compare new-installed vs new-catalog (no delta), so the
  // pre-upgrade version must ride the `--from` flag across the boundary;
  // `--migrations-only` without `--from` is a deliberate true no-op.
  const targetMainVersion = packages.find((p) => p.name === "everything-dev")?.to;
  const versionDelta =
    options.migrationsOnly && !options.from
      ? false
      : options.from !== undefined && targetMainVersion !== undefined
        ? options.from !== targetMainVersion
        : hasFrameworkUpdates;

  if (options.migrationsOnly) {
    return await runMigrationPhase(projectDir, options, parentSource, { versionDelta });
  }

  // Pre-flight (ADR 0032): refuse applies of new packages against stale
  // framework-owned files. The template reconciliation must be ready to run
  // when the new packages land; existing conflicts abort before Phase 1 so a
  // resolution (`--force`, or accepting the template) can happen cleanly.
  if (versionDelta && !options.noSync && !options.force) {
    const preflight = await timePhase(timings, "preflight template sync", () =>
      syncTemplate(projectDir, { dryRun: true }),
    );
    if (preflight.status === "conflicted" || (preflight.conflicted?.length ?? 0) > 0) {
      return {
        status: "error",
        packages: packages,
        timings,
        error:
          `Template files conflict with the upstream release — nothing was applied. ` +
          `Review the conflicts or run \`bos upgrade --force\` to overwrite (current copies are backed up). ` +
          `To make a local change permanent, file an issue: ${UPSTREAM_ISSUE_URL}. ` +
          `Conflicted: ${(preflight.conflicted ?? []).join(", ")}`,
      };
    }
  }

  // Phase 1: apply package updates, install, then re-exec migrations from the new package
  await timePhase(timings, "apply package updates", async () => {
    if (inheritedCatalogPackageNames.length > 0) {
      syncRootCatalogWithParent(projectDir, sourceRootCatalog);
    }

    if (inheritedCatalogPackageNames.length > 0) {
      for (const pkgPath of workspacePkgPaths) {
        updatePackageFileCatalogRefs(pkgPath, inheritedCatalogPackageNames);
      }
    }

    // @better-auth/core rides the catalog row its plugins need; it is not in
    // every template package.json, so it is ensured here rather than sync'd.
    const rootPkgPath = join(workspaceDirOf(projectDir), "package.json");
    const rootPkg = readJsonFile<Record<string, unknown>>(rootPkgPath);
    if (ensureAuthCoreCatalogRef(rootPkg)) {
      writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
    }
    for (const pkgPath of workspacePkgPaths) {
      updatePackageFileAuthCoreRef(pkgPath);
    }
  });

  const needsInstall = (hasUpdates || hasCatalogUpdates) && !options.noInstall;

  if (needsInstall) {
    await timePhase(timings, "install dependencies", () =>
      runPnpmInstallForUpgrade(workspaceDirOf(projectDir)),
    );
  }

  // If we installed new framework packages, re-exec from the new package so migrations
  // run with the latest code instead of the old cached modules.
  if (needsInstall && hasFrameworkUpdates) {
    const bosPath = join(workspaceDirOf(projectDir), "node_modules", ".bin", "bos");
    const prevMainPkg = packages.find((p) => p.name === "everything-dev");
    const childArgs = [
      "upgrade",
      "--migrations-only",
      "--no-install",
      "--from",
      prevMainPkg?.from ?? "unknown",
      ...(options.noSync ? ["--no-sync"] : []),
      ...(options.force ? ["--force"] : []),
      "--json",
    ];

    const childResult = spawnSync(bosPath, childArgs, {
      cwd: projectDir,
      stdio: ["inherit", "pipe", "pipe"],
      encoding: "utf-8",
      env: { ...process.env, BOS_NO_BANNER: "1" },
    });

    if (childResult.status !== 0) {
      return {
        status: "error",
        packages: [
          ...packages,
          ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
        ],
        timings,
        error: `Migration phase failed: ${describeMigrationFailure(childResult.stdout, childResult.stderr)}`,
      };
    }

    try {
      const childUpgrade: UpgradeResult = JSON.parse(childResult.stdout);
      const mainPkg = packages.find((p) => p.name === "everything-dev");
      const changelogUrl =
        mainPkg?.from && mainPkg.from !== mainPkg.to
          ? buildChangelogUrl(mainPkg.from, mainPkg.to, parentSource.repository)
          : undefined;
      return {
        ...childUpgrade,
        packages: [
          ...packages,
          ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
        ],
        timings: [...timings, ...(childUpgrade.timings ?? [])],
        changelogUrl,
      };
    } catch {
      return {
        status: "error",
        packages: [
          ...packages,
          ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
        ],
        timings,
        error: "Failed to parse migration phase output",
      };
    }
  }

  // No framework version change: run migrations inline (same-package, no re-exec needed)
  // runMigrationPhase handles types gen internally — no separate runTypesGen call needed here.
  // ADR 0032: template sync rides the framework version delta — with no delta the
  // framework-owned files are never reconciled; the release tag they target moves
  // only through this pathway.

  const migrationResult = await runMigrationPhase(projectDir, options, parentSource, {
    versionDelta,
  });
  const mainPkg = packages.find((p) => p.name === "everything-dev");
  const changelogUrl =
    mainPkg?.from && mainPkg.from !== mainPkg.to
      ? buildChangelogUrl(mainPkg.from, mainPkg.to, parentSource.repository)
      : undefined;
  return {
    ...migrationResult,
    packages: [
      ...packages,
      ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
    ],
    timings: [...timings, ...(migrationResult.timings ?? [])],
    changelogUrl,
  };
}
