import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import * as p from "@clack/prompts";
import { glob } from "glob";
import { loadResolvedConfig } from "../config";
import type { PhaseTiming, UpgradeOptions, UpgradeResult } from "../contract";
import { resolveExtendsRef } from "../merge";
import { syncResolvedSharedDeps } from "../shared-deps";
import { saveBosConfig } from "../utils/save-config";
import { readInstalledFrameworkVersion } from "./framework-version";
import {
  buildChildRootScripts,
  fetchParentConfig,
  resolveCatalogChainSource,
  runBunInstallForUpgrade,
  runTypesGen,
} from "./init";
import { syncTemplate } from "./sync";
import { timePhase } from "./timing";

const FRAMEWORK_PACKAGES = ["everything-dev", "every-plugin"];
const AUTH_CORE_PACKAGE = "@better-auth/core";
const AUTH_CORE_TRIGGER_PACKAGES = [
  "better-auth",
  "better-near-auth",
  "@better-auth/api-key",
  "@better-auth/passkey",
] as const;
const LEGACY_UI_IMPORT_REWRITES = [
  ['from "@/auth"', 'from "@/app"'],
  ["from '@/auth'", "from '@/app'"],
  ['from "@/lib/auth-utils"', 'from "@/lib/auth"'],
  ["from '@/lib/auth-utils'", "from '@/lib/auth'"],
  ['from "@/lib/use-api-client"', 'from "@/app"'],
  ["from '@/lib/use-api-client'", "from '@/app'"],
  ['from "@/lib/api-client"', 'from "@/app"'],
  ["from '@/lib/api-client'", "from '@/app'"],
] as const;
const OBSOLETE_FILES = [
  "ui/src/auth.ts",
  "ui/src/auth-types.gen.ts",
  "ui/src/lib/api-client.ts",
  "ui/src/lib/use-api-client.ts",
  "ui/src/lib/auth-utils.ts",
  "ui/src/api-contract.ts",
  "ui/src/api-contract.gen.ts",
  "ui/src/lib/auth-client.ts",
  "ui/src/lib/session.ts",
  "ui/scripts/generate-metadata.ts",
  ".github/dependabot.yml",
  ".github/templates/dependabot.yml",
  ".github/renovate.json",
  ".github/workflows/packages-release.yml",
  ".github/workflows/publish.yml",
  ".github/workflows/release.yml",
  ".github/workflows/release-sync.yml",
  "packages/everything-dev/cli.js",
  ".templatekeep",
  ".templatesync-exclude",
];

interface ExtendedRootSource {
  catalog: Record<string, string>;
  repository?: string;
  extendsChain: string[];
}

function extractSemver(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function readRootPackageJson(projectDir: string): Record<string, unknown> {
  return readJsonFile<Record<string, unknown>>(join(projectDir, "package.json"));
}

function readRootCatalogEntry(projectDir: string, packageName: string): string | undefined {
  const pkg = readRootPackageJson(projectDir) as {
    workspaces?: { catalog?: Record<string, string> };
  };
  return pkg.workspaces?.catalog?.[packageName];
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

    if (value.startsWith("workspace:") || value.startsWith("file:")) {
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
      if (value !== "catalog:" && !value.startsWith("file:")) {
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
  const pkgPath = join(projectDir, "package.json");
  const pkg = readJsonFile<Record<string, unknown>>(pkgPath);
  let modified = syncPackageObjectCatalogRefs(pkg, Object.keys(parentCatalog));

  if (!pkg.workspaces || typeof pkg.workspaces !== "object") {
    pkg.workspaces = { packages: [], catalog: {} };
    modified = true;
  }

  const workspaces = pkg.workspaces as { packages?: string[]; catalog?: Record<string, string> };
  if (!workspaces.catalog || typeof workspaces.catalog !== "object") {
    workspaces.catalog = {};
    modified = true;
  }

  for (const [packageName, version] of Object.entries(parentCatalog)) {
    if (workspaces.catalog[packageName] !== version) {
      workspaces.catalog[packageName] = version;
      modified = true;
    }
  }

  if (modified) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return modified;
}

async function readExtendedRootSource(projectDir: string): Promise<ExtendedRootSource> {
  const configPath = join(projectDir, "bos.config.json");
  if (!existsSync(configPath)) {
    return { catalog: {}, extendsChain: [] };
  }

  const localConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  let extendsRef = getExtendsRef(localConfig);
  if (!extendsRef?.startsWith("bos://")) {
    return {
      catalog: {},
      repository: typeof localConfig.repository === "string" ? localConfig.repository : undefined,
      extendsChain: [],
    };
  }

  const extendsChain: string[] = [];
  const visited = new Set<string>();
  let repository = typeof localConfig.repository === "string" ? localConfig.repository : undefined;
  let rootRef = extendsRef;

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

    rootRef = extendsRef;

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

  const parsed = parseBosRef(rootRef);
  if (!parsed) {
    return { catalog: {}, repository, extendsChain };
  }

  const source = await resolveCatalogChainSource({
    extendsAccount: parsed.account,
    extendsGateway: parsed.gateway,
  });

  return {
    catalog: source.catalog,
    repository: source.repository ?? repository,
    extendsChain: source.extendsChain.length > 0 ? source.extendsChain : extendsChain,
  };
}

function getExtendsRef(config: Record<string, unknown>): string | undefined {
  if (typeof config.extends === "string") {
    return config.extends;
  }

  if (config.extends && typeof config.extends === "object") {
    return resolveExtendsRef(config.extends as Record<string, string>, "production");
  }

  return undefined;
}

function parseBosRef(ref: string): { account: string; gateway: string } | null {
  const match = ref.match(/^bos:\/\/([^/]+)\/(.+)$/);
  if (!match?.[1] || !match[2]) return null;
  return { account: match[1], gateway: match[2] };
}

function parseTargetedRef(ref: string): { configRef: string; targetPath?: string } {
  const hashIndex = ref.indexOf("#");
  if (hashIndex === -1) {
    return { configRef: ref };
  }
  return {
    configRef: ref.slice(0, hashIndex),
    targetPath: ref.slice(hashIndex + 1) || undefined,
  };
}

function ensureTargetedRef(ref: string, targetPath: string): string {
  const parsed = parseTargetedRef(ref);
  if (parsed.targetPath) return ref;
  return `${parsed.configRef}#${targetPath}`;
}

function rewriteExtendsTarget(
  entry: Record<string, unknown> | undefined,
  targetPath: string,
): boolean {
  if (!entry?.extends) return false;

  if (typeof entry.extends === "string") {
    const next = ensureTargetedRef(entry.extends, targetPath);
    if (next === entry.extends) return false;
    entry.extends = next;
    return true;
  }

  if (typeof entry.extends === "object") {
    let changed = false;
    for (const [key, value] of Object.entries(entry.extends as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      const next = ensureTargetedRef(value, targetPath);
      if (next !== value) {
        (entry.extends as Record<string, unknown>)[key] = next;
        changed = true;
      }
    }
    return changed;
  }

  return false;
}

function migrateRootConfigTargets(config: Record<string, unknown>): boolean {
  let changed = false;
  const app =
    config.app && typeof config.app === "object"
      ? (config.app as Record<string, unknown>)
      : undefined;

  if (app?.api && typeof app.api === "object") {
    changed = rewriteExtendsTarget(app.api as Record<string, unknown>, "app.api") || changed;
  }
  if (app?.auth && typeof app.auth === "object") {
    changed = rewriteExtendsTarget(app.auth as Record<string, unknown>, "app.auth") || changed;
  }

  if (config.plugins && typeof config.plugins === "object") {
    for (const [pluginKey, pluginValue] of Object.entries(
      config.plugins as Record<string, unknown>,
    )) {
      if (typeof pluginValue === "string") {
        const next = ensureTargetedRef(pluginValue, `plugins.${pluginKey}`);
        if (next !== pluginValue) {
          (config.plugins as Record<string, unknown>)[pluginKey] = next;
          changed = true;
        }
        continue;
      }
      if (!pluginValue || typeof pluginValue !== "object") continue;
      changed =
        rewriteExtendsTarget(pluginValue as Record<string, unknown>, `plugins.${pluginKey}`) ||
        changed;
    }
  }

  return changed;
}

function migratePluginProviderConfig(config: Record<string, unknown>, pluginKey: string): boolean {
  let changed = false;
  if (!config.plugins || typeof config.plugins !== "object") {
    return false;
  }

  const plugins = config.plugins as Record<string, unknown>;
  const entry = plugins[pluginKey];
  if (!entry || typeof entry !== "object") return false;

  const pluginEntry = entry as Record<string, unknown>;

  if ("name" in pluginEntry) {
    delete pluginEntry.name;
    changed = true;
  }

  if (typeof pluginEntry.development === "string" && pluginEntry.development.startsWith("local:")) {
    if ("extends" in pluginEntry) {
      delete pluginEntry.extends;
      changed = true;
    }
  }

  changed = rewriteExtendsTarget(pluginEntry, `plugins.${pluginKey}`) || changed;

  return changed;
}

function mergePluginConfigIntoRoot(
  rootConfig: Record<string, unknown>,
  pluginKey: string,
  pluginConfig: Record<string, unknown>,
): boolean {
  let changed = false;

  if (!rootConfig.plugins || typeof rootConfig.plugins !== "object") {
    rootConfig.plugins = {};
    changed = true;
  }
  const plugins = rootConfig.plugins as Record<string, unknown>;
  if (!plugins[pluginKey] || typeof plugins[pluginKey] !== "object") {
    plugins[pluginKey] = {};
    changed = true;
  }

  const entry = plugins[pluginKey] as Record<string, unknown>;

  const pluginData = extractPluginEntry(pluginConfig, pluginKey);

  const apiData = getApiEntry(pluginConfig);

  if (pluginData) {
    for (const key of [
      "secrets",
      "variables",
      "routes",
      "sidebar",
      "production",
      "integrity",
      "proxy",
    ] as const) {
      if (pluginData[key] !== undefined && entry[key] === undefined) {
        entry[key] = pluginData[key];
        changed = true;
      }
    }

    if (typeof pluginData.development === "string" && pluginData.development.startsWith("local:")) {
      pluginData.development = `local:plugins/${pluginKey}`;
    }
    if (entry.development === undefined && pluginData.development !== undefined) {
      entry.development = pluginData.development;
      changed = true;
    }
  }

  if (apiData) {
    for (const key of [
      "production",
      "integrity",
      "proxy",
      "variables",
      "secrets",
      "sidebar",
      "routes",
    ] as const) {
      if (apiData[key] !== undefined && entry[key] === undefined) {
        entry[key] = apiData[key];
        changed = true;
      }
    }
  }

  if ("extends" in entry) {
    const extendsStr = typeof entry.extends === "string" ? entry.extends : undefined;
    if (!extendsStr || extendsStr.includes(`#plugins.${pluginKey}`)) {
      delete entry.extends;
      changed = true;
    }
  }

  if ("name" in entry) {
    delete entry.name;
    changed = true;
  }

  if (configHasTopLevelFields(pluginConfig, pluginKey)) {
    if (entry.routes === undefined && Array.isArray(pluginConfig.routes)) {
      entry.routes = pluginConfig.routes;
      changed = true;
    }
    if (entry.sidebar === undefined && Array.isArray(pluginConfig.sidebar)) {
      entry.sidebar = pluginConfig.sidebar;
      changed = true;
    }
    const api = getApiEntry(pluginConfig);
    if (api) {
      if (entry.routes === undefined && Array.isArray(api.routes)) {
        entry.routes = api.routes;
        changed = true;
      }
      if (entry.sidebar === undefined && Array.isArray(api.sidebar)) {
        entry.sidebar = api.sidebar;
        changed = true;
      }
    }
  }

  return changed;
}

function extractPluginEntry(
  pluginConfig: Record<string, unknown>,
  pluginKey: string,
): Record<string, unknown> | null {
  if (
    pluginConfig.plugins &&
    typeof pluginConfig.plugins === "object" &&
    (pluginConfig.plugins as Record<string, unknown>)[pluginKey] &&
    typeof (pluginConfig.plugins as Record<string, unknown>)[pluginKey] === "object"
  ) {
    return (pluginConfig.plugins as Record<string, unknown>)[pluginKey] as Record<string, unknown>;
  }

  const fallback: Record<string, unknown> = {};
  if (pluginConfig.sidebar !== undefined) {
    fallback.sidebar = pluginConfig.sidebar;
  }
  if (pluginConfig.routes !== undefined) {
    fallback.routes = pluginConfig.routes;
  }
  if (Object.keys(fallback).length > 0) {
    return fallback;
  }

  return null;
}

function configHasTopLevelFields(
  pluginConfig: Record<string, unknown>,
  _pluginKey: string,
): boolean {
  return (
    (pluginConfig.routes !== undefined && Array.isArray(pluginConfig.routes)) ||
    (pluginConfig.sidebar !== undefined && Array.isArray(pluginConfig.sidebar)) ||
    getApiEntry(pluginConfig) !== null
  );
}

function getApiEntry(pluginConfig: Record<string, unknown>): Record<string, unknown> | null {
  if (!pluginConfig.app || typeof pluginConfig.app !== "object") return null;
  const app = pluginConfig.app as Record<string, unknown>;
  if (!app.api || typeof app.api !== "object") return null;
  return app.api as Record<string, unknown>;
}

export async function migrateBosConfigFiles(projectDir: string): Promise<string[]> {
  const migrated: string[] = [];
  const rootConfigPath = join(projectDir, "bos.config.json");

  if (existsSync(rootConfigPath)) {
    const rootConfig = JSON.parse(readFileSync(rootConfigPath, "utf-8")) as Record<string, unknown>;
    let rootChanged = migrateRootConfigTargets(rootConfig);

    const pluginConfigPaths = await glob("plugins/*/bos.config.json", {
      cwd: projectDir,
      nodir: true,
      dot: false,
      absolute: false,
    });

    for (const relativePath of pluginConfigPaths) {
      const match = relativePath.match(/^plugins\/([^/]+)\/bos\.config\.json$/);
      const pluginKey = match?.[1];
      if (!pluginKey) continue;

      const filePath = join(projectDir, relativePath);
      try {
        const pluginConfig = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
        rootChanged = mergePluginConfigIntoRoot(rootConfig, pluginKey, pluginConfig) || rootChanged;
      } catch {}

      try {
        rmSync(filePath);
        migrated.push(relativePath);
      } catch {}
    }

    if (rootConfig.plugins && typeof rootConfig.plugins === "object") {
      for (const pluginKey of Object.keys(rootConfig.plugins as Record<string, unknown>)) {
        rootChanged = migratePluginProviderConfig(rootConfig, pluginKey) || rootChanged;
      }
    }

    if (rootChanged || migrated.length > 0) {
      await saveBosConfig(projectDir, rootConfig);
      if (!migrated.includes("bos.config.json")) {
        migrated.push("bos.config.json");
      }
    }
  }

  return migrated;
}

async function loadParentPluginOptions(projectDir: string): Promise<{
  localConfig: Record<string, unknown>;
  parentPlugins: Record<string, unknown>;
  newPluginKeys: string[];
} | null> {
  const configPath = join(projectDir, "bos.config.json");
  if (!existsSync(configPath)) {
    return null;
  }

  const localConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
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

async function addSelectedParentPlugins(projectDir: string): Promise<string[]> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return [];
  }

  const pluginOptions = await loadParentPluginOptions(projectDir);
  if (!pluginOptions || pluginOptions.newPluginKeys.length === 0) {
    return [];
  }

  const selectedValue = await p.multiselect({
    message: "Select new plugins from parent:",
    options: pluginOptions.newPluginKeys.map((key) => ({ value: key, label: key })),
    required: false,
  });

  if (p.isCancel(selectedValue)) {
    process.exit(0);
  }

  const selected = selectedValue as string[];
  if (selected.length === 0) {
    return [];
  }

  const localPlugins =
    pluginOptions.localConfig.plugins && typeof pluginOptions.localConfig.plugins === "object"
      ? (pluginOptions.localConfig.plugins as Record<string, unknown>)
      : {};
  const nextPlugins = { ...localPlugins };
  for (const key of selected) {
    const parentPlugin = pluginOptions.parentPlugins[key];
    if (parentPlugin && typeof parentPlugin === "object") {
      const nextPlugin = structuredClone(parentPlugin as Record<string, unknown>);
      rewriteExtendsTarget(nextPlugin, `plugins.${key}`);
      nextPlugins[key] = nextPlugin;
    } else if (typeof parentPlugin === "string") {
      nextPlugins[key] = ensureTargetedRef(parentPlugin, `plugins.${key}`);
    } else {
      nextPlugins[key] = parentPlugin;
    }
  }

  pluginOptions.localConfig.plugins = nextPlugins;
  await saveBosConfig(projectDir, pluginOptions.localConfig);

  return selected;
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
  const rootPkgPath = join(projectDir, "package.json");
  if (!existsSync(rootPkgPath)) return [];

  const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8")) as Record<string, unknown>;
  const workspaceConfig = rootPkg.workspaces as { packages?: string[] } | string[] | undefined;

  const patterns: string[] = [];
  if (Array.isArray(workspaceConfig)) {
    patterns.push(...workspaceConfig);
  } else if (workspaceConfig?.packages && Array.isArray(workspaceConfig.packages)) {
    patterns.push(...workspaceConfig.packages);
  }

  if (patterns.length === 0) return [];

  const pkgPaths: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { cwd: projectDir, dot: false, absolute: false });
    for (const match of matches) {
      const pkgPath = join(projectDir, match, "package.json");
      if (existsSync(pkgPath) && statSync(pkgPath).isFile()) {
        pkgPaths.push(pkgPath);
      }
    }
  }

  return [...new Set(pkgPaths)];
}

export async function migrateChildRootPackageJson(projectDir: string): Promise<boolean> {
  const configPath = join(projectDir, "bos.config.json");
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(configPath) || !existsSync(pkgPath)) {
    return false;
  }

  const config = readJsonFile<Record<string, unknown>>(configPath);
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
  for (const obsoleteScript of ["sync-catalog", "init"]) {
    if (obsoleteScript in scripts) {
      delete scripts[obsoleteScript];
      changed = true;
    }
  }

  const workspaces = pkg.workspaces;
  if (workspaces && typeof workspaces === "object") {
    const workspaceConfig = workspaces as { packages?: string[] };
    if (Array.isArray(workspaceConfig.packages)) {
      const nextPackages = workspaceConfig.packages.filter(
        (entry) => entry !== "packages/everything-dev" && entry !== "packages/every-plugin",
      );
      if (nextPackages.length !== workspaceConfig.packages.length) {
        workspaceConfig.packages = nextPackages;
        changed = true;
      }
    }
  }

  if (pkg.overrides && typeof pkg.overrides === "object") {
    const overrides = pkg.overrides as Record<string, string>;
    for (const packageName of FRAMEWORK_PACKAGES) {
      const value = overrides[packageName];
      if (typeof value === "string" && value.startsWith("file:packages/")) {
        delete overrides[packageName];
        changed = true;
      }
    }
    if (Object.keys(overrides).length === 0) {
      delete pkg.overrides;
      changed = true;
    }
  }

  if (ensureAuthCoreCatalogRef(pkg)) {
    changed = true;
  }

  const workspacePackageJsons = await findWorkspacePackageJsons(projectDir);
  for (const workspacePkgPath of workspacePackageJsons) {
    if (updatePackageFileAuthCoreRef(workspacePkgPath)) {
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

async function rewriteLegacyUiImports(projectDir: string): Promise<string[]> {
  const files = await glob("ui/src/**/*.{ts,tsx}", {
    cwd: projectDir,
    nodir: true,
    dot: false,
    absolute: false,
  });
  const migrated: string[] = [];

  for (const file of files) {
    const filePath = join(projectDir, file);
    const original = readFileSync(filePath, "utf-8");
    let next = original;

    for (const [from, to] of LEGACY_UI_IMPORT_REWRITES) {
      next = next.replaceAll(from, to);
    }

    if (next !== original) {
      writeFileSync(filePath, next);
      migrated.push(file);
    }
  }

  return migrated;
}

export async function upgradeTemplate(
  projectDir: string,
  options: UpgradeOptions,
): Promise<UpgradeResult> {
  const timings: PhaseTiming[] = [];
  const pkgPath = join(projectDir, "package.json");
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
  const currentRootCatalog = readRootPackageJson(projectDir) as {
    workspaces?: { catalog?: Record<string, string> };
  };
  const currentCatalogEntries = currentRootCatalog.workspaces?.catalog ?? {};
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

      const nextCatalogVersionUpdates: Array<{
        name: string;
        from: string | undefined;
        to: string;
      }> = [];
      for (const [name, targetVersion] of Object.entries(sourceRootCatalog)) {
        if (FRAMEWORK_PACKAGES.includes(name)) continue;

        const currentVersion = currentCatalogEntries[name];
        if (currentVersion === targetVersion) continue;
        nextCatalogVersionUpdates.push({ name, from: currentVersion, to: targetVersion });
      }

      return { packages: nextPackages, catalogVersionUpdates: nextCatalogVersionUpdates };
    },
  );

  const hasFrameworkUpdates = packages.some((p) => p.from !== p.to && p.from !== undefined);
  const hasCatalogUpdates = catalogVersionUpdates.length > 0;
  const hasUpdates =
    hasFrameworkUpdates || hasCatalogUpdates || hasCatalogRefRewrites || hasAuthCoreRefRewrites;

  if (options.dryRun) {
    let changelogUrl: string | undefined;
    const pluginOptions = options.noSync
      ? null
      : await timePhase(timings, "discover parent plugins", () =>
          loadParentPluginOptions(projectDir),
        );
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
      timings,
      changelogUrl,
    };
  }

  await timePhase(timings, "apply package updates", async () => {
    if (inheritedCatalogPackageNames.length > 0) {
      syncRootCatalogWithParent(projectDir, sourceRootCatalog);
    }

    if (inheritedCatalogPackageNames.length > 0) {
      for (const pkgPath of workspacePkgPaths) {
        updatePackageFileCatalogRefs(pkgPath, inheritedCatalogPackageNames);
      }
    }
  });

  const migratedBosConfigs = await timePhase(timings, "migrate bos configs", () =>
    migrateBosConfigFiles(projectDir),
  );
  const migratedRootPackageJson = await timePhase(timings, "migrate root package", () =>
    migrateChildRootPackageJson(projectDir),
  );

  let syncResult: UpgradeResult["sync"];
  let addedPlugins: string[] = [];
  if (!options.noSync) {
    addedPlugins = await timePhase(timings, "discover parent plugins", async () => {
      if (options.dryRun) return [];
      return addSelectedParentPlugins(projectDir);
    });

    syncResult = await timePhase(timings, "sync template", () =>
      syncTemplate(projectDir, {
        dryRun: false,
        noInstall: true,
      }),
    );

    if (inheritedCatalogPackageNames.length > 0) {
      syncRootCatalogWithParent(projectDir, sourceRootCatalog);
    }
  }

  const sharedSync = await timePhase(timings, "sync shared deps", async () => {
    const configResult = await loadResolvedConfig({ cwd: projectDir });
    if (!configResult) {
      throw new Error("No bos.config.json found in current directory");
    }

    return syncResolvedSharedDeps({
      configDir: projectDir,
      hostMode: "local",
      bosConfig: configResult.config,
    });
  });

  if ((hasUpdates || addedPlugins.length > 0 || sharedSync.catalogChanged) && !options.noInstall) {
    await timePhase(timings, "install dependencies", () => runBunInstallForUpgrade(projectDir));
    await timePhase(timings, "generate types", () => runTypesGen(projectDir));
  }

  const migratedFiles = await timePhase(timings, "clean obsolete files", async () => {
    const nextMigratedFiles = [
      ...migratedBosConfigs,
      ...(migratedRootPackageJson ? ["package.json"] : []),
      ...(await rewriteLegacyUiImports(projectDir)),
    ];
    for (const file of OBSOLETE_FILES) {
      const filePath = join(projectDir, file);
      if (existsSync(filePath)) {
        rmSync(filePath);
        nextMigratedFiles.push(file);
      }
    }
    return nextMigratedFiles;
  });

  let changelogUrl: string | undefined;
  const mainPkg = packages.find((p) => p.name === "everything-dev");
  if (mainPkg?.from && mainPkg.from !== mainPkg.to) {
    changelogUrl = buildChangelogUrl(mainPkg.from, mainPkg.to, parentSource.repository);
  }

  return {
    status: "upgraded",
    packages: [
      ...packages,
      ...catalogVersionUpdates.map((u) => ({ name: u.name, from: u.from, to: u.to })),
    ],
    sync: syncResult,
    migrated: migratedFiles.length > 0 ? migratedFiles : undefined,
    selectedPlugins: addedPlugins.length > 0 ? addedPlugins : undefined,
    timings,
    changelogUrl,
  };
}
