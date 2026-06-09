import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isPlainObject, type BosEnv, type ResolvedConfigMeta, rebuildOrderedConfig } from "./merge";
import { SharedDepMapSchema, type SharedDepConfig } from "./types";

interface PackageJson {
  workspaces?: {
    packages?: string[];
    catalog?: Record<string, string>;
  };
}

interface SharedDepRef {
  source: string;
  config: SharedDepConfig;
}

type SharedDepsConfig = Record<string, unknown>;

interface NormalizedSharedDepConfig {
  version: string;
  requiredVersion: string | false;
  singleton: boolean;
  eager: boolean;
  strictVersion: boolean;
  shareScope: string;
}

export interface ResolvedSharedDep {
  name: string;
  version: string;
  requiredVersion: string;
  shareScope: string;
  singleton: boolean;
  eager: boolean;
  strictVersion: boolean;
  sources: string[];
}

export interface ResolvedSharedDeps {
  deps: Record<string, ResolvedSharedDep>;
  fingerprintSha256: string;
}

export interface SharedDepsSyncResult {
  mode: "catalog->bos" | "bos->catalog";
  hostMode: "local" | "remote";
  bosConfigChanged: boolean;
  catalogChanged: boolean;
  generatedChanged: boolean;
  resolved: ResolvedSharedDeps;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function extractSemverExact(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const match = input.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match ? match[0] : null;
}

function caretRange(version: string): string {
  return `^${version}`;
}

function stableDepsObject(deps: Record<string, ResolvedSharedDep>): Record<string, ResolvedSharedDep> {
  const keys = Object.keys(deps).sort((a, b) => a.localeCompare(b));
  const out: Record<string, ResolvedSharedDep> = {};
  for (const key of keys) {
    out[key] = deps[key]!;
  }
  return out;
}

function normalizeSharedDepConfig(config: SharedDepConfig): NormalizedSharedDepConfig {
  return {
    version: config.version,
    requiredVersion: config.requiredVersion ?? false,
    singleton: config.singleton ?? false,
    eager: config.eager ?? false,
    strictVersion: config.strictVersion ?? false,
    shareScope: config.shareScope ?? "default",
  };
}

function getObject(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function getSharedDepsMap(
  value: unknown,
  source: string,
): Record<string, SharedDepConfig> | undefined {
  if (value === undefined) return undefined;
  const parsed = SharedDepMapSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid shared dependency map at ${source}`);
  }
  return value as Record<string, SharedDepConfig>;
}

function writeFileIfChanged(filePath: string, nextContent: string): boolean {
  try {
    const current = readFileSync(filePath, "utf-8");
    if (current === nextContent) return false;
  } catch {
    // file does not exist yet
  }

  writeFileSync(filePath, nextContent);
  return true;
}

function fingerprintResolved(deps: Record<string, ResolvedSharedDep>): string {
  return sha256(JSON.stringify(stableDepsObject(deps)));
}

function isSameSharedDepConfig(a: SharedDepConfig, b: SharedDepConfig): boolean {
  const left = normalizeSharedDepConfig(a);
  const right = normalizeSharedDepConfig(b);

  return (
    left.version === right.version &&
    left.requiredVersion === right.requiredVersion &&
    left.singleton === right.singleton &&
    left.eager === right.eager &&
    left.strictVersion === right.strictVersion &&
    left.shareScope === right.shareScope
  );
}

function collectSharedDepRefs(bosConfig: SharedDepsConfig): Record<string, SharedDepRef[]> {
  const refs = new Map<string, SharedDepRef[]>();

  const app = getObject(bosConfig.app);
  const appUi = getObject(app?.ui);
  const appApi = getObject(app?.api);
  const appAuth = getObject(app?.auth);
  const plugins = getObject(bosConfig.plugins);

  if (appUi && "shared" in appUi) {
    throw new Error(
      'app.ui.shared is no longer supported. Move shared deps to app.api.shared, app.auth.shared, or plugins.*.shared.',
    );
  }

  const append = (source: string, shared: Record<string, SharedDepConfig> | undefined) => {
    if (!shared) return;

    for (const [name, config] of Object.entries(shared)) {
      const existing = refs.get(name);
      if (!existing) {
        refs.set(name, [{ source, config }]);
        continue;
      }

      if (!isSameSharedDepConfig(existing[0]!.config, config)) {
        const previous = existing.map((ref) => ref.source).join(", ");
        throw new Error(
          `Conflicting shared dependency "${name}" between ${previous} and ${source}`,
        );
      }

      existing.push({ source, config });
    }
  };

  append("app.api", getSharedDepsMap(appApi?.shared, "app.api.shared"));
  append("app.auth", getSharedDepsMap(appAuth?.shared, "app.auth.shared"));

  for (const [pluginId, plugin] of Object.entries(plugins ?? {})) {
    const pluginRecord = getObject(plugin);
    if (!pluginRecord) continue;

    const pluginApp = getObject(pluginRecord.app);
    const pluginUi = getObject(pluginApp?.ui);
    if (pluginUi && "shared" in pluginUi) {
      throw new Error(
        `app.ui.shared is no longer supported in plugins.${pluginId}. Move shared deps to app.api.shared, app.auth.shared, or plugins.*.shared.`,
      );
    }
    append(
      `plugins.${pluginId}`,
      getSharedDepsMap(pluginRecord.shared, `plugins.${pluginId}.shared`),
    );
  }

  return Object.fromEntries(refs);
}

export async function syncResolvedSharedDeps(opts: {
  configDir: string;
  hostMode: "local" | "remote";
  bosConfig?: SharedDepsConfig;
  env?: BosEnv;
  extendsChain?: string[];
}): Promise<SharedDepsSyncResult> {
  const bosConfigPath = join(opts.configDir, "bos.config.json");
  const resolvedConfigPath = join(opts.configDir, ".bos", "bos.resolved-config.json");
  const packageJsonPath = join(opts.configDir, "package.json");
  const generatedPath = join(opts.configDir, ".bos", "generated", "shared-deps.json");

  const bosConfig: unknown = opts.bosConfig ?? JSON.parse(readFileSync(bosConfigPath, "utf-8"));
  if (!isPlainObject(bosConfig)) {
    throw new Error("bos.config.json must be an object");
  }

  const pkgJson = existsSync(packageJsonPath)
    ? (JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageJson)
    : {};

  const originalBos = JSON.stringify(bosConfig);
  const originalPkg = JSON.stringify(pkgJson);

  const mode = opts.hostMode === "local" ? "catalog->bos" : "bos->catalog";
  const refsByName = collectSharedDepRefs(bosConfig);
  const catalog = pkgJson.workspaces?.catalog ?? {};

  const resolvedDeps: Record<string, ResolvedSharedDep> = {};

  for (const [name, refs] of Object.entries(refsByName)) {
    const first = refs[0];
    if (!first) continue;

    const exactFromConfig = extractSemverExact(first.config.version) ?? extractSemverExact(first.config.requiredVersion);
    const exactFromCatalog = extractSemverExact(catalog[name]);
    const version = mode === "catalog->bos" ? exactFromCatalog ?? exactFromConfig : exactFromConfig ?? exactFromCatalog;

    if (!version) {
      const sources = refs.map((ref) => ref.source).join(", ");
      throw new Error(`Could not resolve exact version for shared dependency "${name}" from ${sources}`);
    }

    if (mode === "catalog->bos" && exactFromCatalog === null && exactFromConfig) {
      catalog[name] = exactFromConfig;
    }

    if (mode === "bos->catalog" && catalog[name] !== version) {
      catalog[name] = version;
    }

    for (const ref of refs) {
      ref.config.version = version;
      ref.config.requiredVersion = caretRange(version);
      ref.config.shareScope = ref.config.shareScope ?? "default";
    }

    resolvedDeps[name] = {
      name,
      version,
      requiredVersion: caretRange(version),
      shareScope: first.config.shareScope ?? "default",
      singleton: first.config.singleton ?? false,
      eager: first.config.eager ?? false,
      strictVersion: first.config.strictVersion ?? false,
      sources: refs.map((ref) => ref.source).sort((a, b) => a.localeCompare(b)),
    };
  }

  if (!pkgJson.workspaces) {
    pkgJson.workspaces = { packages: [], catalog: {} };
  }
  pkgJson.workspaces.catalog = catalog;

  const nextBos = JSON.stringify(bosConfig);
  const nextPkg = JSON.stringify(pkgJson);
  const bosConfigChanged = nextBos !== originalBos;
  const catalogChanged = nextPkg !== originalPkg;

  if (bosConfigChanged) {
    const resolvedDir = dirname(resolvedConfigPath);
    if (!existsSync(resolvedDir)) {
      mkdirSync(resolvedDir, { recursive: true });
    }

    const ordered = rebuildOrderedConfig(bosConfig);
    const meta: ResolvedConfigMeta = {
      env: opts.env ?? "development",
      resolvedAt: new Date().toISOString(),
      extendsChain: opts.extendsChain ?? [],
      source: "shared-sync",
    };
    const resolvedOutput = {
      _resolved: meta,
      ...ordered,
    };

    writeFileIfChanged(resolvedConfigPath, `${JSON.stringify(resolvedOutput, null, 2)}\n`);
  }

  if (catalogChanged) {
    writeFileIfChanged(packageJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
  }

  const stableResolvedDeps = stableDepsObject(resolvedDeps);
  const resolved: ResolvedSharedDeps = {
    deps: stableResolvedDeps,
    fingerprintSha256: fingerprintResolved(stableResolvedDeps),
  };

  const nextGenerated = {
    schemaVersion: 1,
    kind: "everything-dev/shared-deps",
    generatedAt: new Date().toISOString(),
    deps: stableResolvedDeps,
    fingerprintSha256: resolved.fingerprintSha256,
    inputs: {
      mode,
      hostMode: opts.hostMode,
    },
  };

  let prevFingerprint: string | null = null;
  try {
    const prev = JSON.parse(readFileSync(generatedPath, "utf-8"));
    prevFingerprint = prev?.fingerprintSha256 ?? null;
  } catch {
    // ignore
  }

  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileIfChanged(generatedPath, `${JSON.stringify(nextGenerated, null, 2)}\n`);

  const generatedChanged = prevFingerprint !== nextGenerated.fingerprintSha256;

  return {
    mode,
    hostMode: opts.hostMode,
    bosConfigChanged,
    catalogChanged,
    generatedChanged,
    resolved,
  };
}
