/**
 * SharedDependencySpec: the one module owning shared-dependency names,
 * criticality, version resolution, and fallback policy across the Module
 * Federation graph. Four consumers derive from it — the rspack config
 * factory (plugin builds), the rsbuild config factory (ui remotes), the
 * runtime mf-config (the every-plugin MF instance), and the host's shared
 * pre-registration — so a name or criticality can never disagree between
 * them, and an unresolved version fails the build loudly instead of
 * silently degrading to "*"/"latest" (which disables the strict-singleton
 * guard).
 *
 * Lists:
 * - core: shared by the host and server-side plugin remotes (every-plugin,
 *   effect, zod, @orpc/*). Effect-critical entries pin the exact installed
 *   version (strictVersion) — the version-check machinery in
 *   runtime/services/shared-identity.ts relies on it.
 * - ui: shared by the core ui provider and ui remotes (react, react-dom,
 *   @orpc/client, @orpc/contract, TanStack, lingui, the everything-dev
 *   session/i18n subpath modules). All strict singletons; consumers add
 *   `import: false`.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Data } from "effect";

const require = createRequire(import.meta.url);

export class SharedDependencyResolutionError extends Data.TaggedError(
  "SharedDependencyResolutionError",
)<{
  readonly packageName: string;
  readonly searched: string[];
}> {
  constructor(packageName: string, searched: string[]) {
    super({
      packageName,
      searched,
    });
  }

  override get message() {
    return (
      `Could not resolve shared dependency "${this.packageName}". Looked in:\n` +
      this.searched.map((location) => `  - ${location}`).join("\n") +
      `\nUnresolved shared dependencies fail loudly (no "*", no "latest" fallback) — ` +
      `install the package in the resolving workspace or pin a resolvable version.`
    );
  }
}

export type SharedDependencyResolution = "self" | "package" | "subpath";

export interface SharedDependencySpec {
  name: string;
  singleton: true;
  /** exact-version pin (requiredVersion = resolved version, strictVersion = true) */
  critical: boolean;
  resolution: SharedDependencyResolution;
  optional?: true;
}

export const CORE_SHARED_DEPS = [
  { name: "every-plugin", singleton: true, critical: true, resolution: "self" },
  { name: "effect", singleton: true, critical: true, resolution: "package" },
  { name: "zod", singleton: true, critical: false, resolution: "package" },
  { name: "@orpc/contract", singleton: true, critical: true, resolution: "package" },
  { name: "@orpc/client", singleton: true, critical: true, resolution: "package" },
  { name: "@orpc/server", singleton: true, critical: true, resolution: "package" },
  // v1's proven sharing set, restored: @orpc/openapi, @orpc/experimental-effect,
  // and @orpc/publisher joined this list in the v2 fleet-spec pass and their
  // share-scope consumption broke plugin loading at runtime
  // (__webpack_modules__[r] is not a function — the runtime's import()-based
  // provides hand the consumer an ESM namespace where a module factory is
  // expected). They stay declared in each workspace's package.json and are
  // bundled per workspace instead.
] as const satisfies readonly SharedDependencySpec[];

export type CoreSharedDepName = (typeof CORE_SHARED_DEPS)[number]["name"];

const coreCriticalNames = CORE_SHARED_DEPS.flatMap((spec) => (spec.critical ? [spec.name] : []));

/**
 * Effect-critical shared names, derived from the core list's `critical: true`
 * entries — the one source of criticality (`strictVersion` pinning in the
 * runtime's version-check machinery keys off this list).
 */
export const EFFECT_CRITICAL_SHARED_DEPS: readonly EffectCriticalSharedDepName[] =
  coreCriticalNames;

export type EffectCriticalSharedDepName = (typeof coreCriticalNames)[number];

export const isEffectCriticalSharedDep = (name: string): boolean =>
  (EFFECT_CRITICAL_SHARED_DEPS as readonly string[]).includes(name);

export const UI_SHARED_DEPS = [
  { name: "react", singleton: true, critical: true, resolution: "package" },
  { name: "react-dom", singleton: true, critical: true, resolution: "package" },
  { name: "@orpc/client", singleton: true, critical: true, resolution: "package" },
  { name: "@orpc/contract", singleton: true, critical: true, resolution: "package" },
  { name: "@tanstack/react-query", singleton: true, critical: true, resolution: "package" },
  { name: "@tanstack/react-router", singleton: true, critical: true, resolution: "package" },
  { name: "@lingui/core", singleton: true, critical: true, resolution: "package" },
  { name: "@lingui/react", singleton: true, critical: true, resolution: "package" },
  { name: "sonner", singleton: true, critical: true, resolution: "package", optional: true },
  {
    name: "everything-dev/ui/auth",
    singleton: true,
    critical: true,
    resolution: "subpath",
  },
  {
    name: "everything-dev/ui/i18n",
    singleton: true,
    critical: true,
    resolution: "subpath",
  },
] as const satisfies readonly SharedDependencySpec[];

export const SHARED_DEP_SPECS: readonly SharedDependencySpec[] = (() => {
  const byName = new Map<string, SharedDependencySpec>();
  for (const spec of [...CORE_SHARED_DEPS, ...UI_SHARED_DEPS]) {
    const existing = byName.get(spec.name);
    if (existing) {
      if (existing.critical !== spec.critical) {
        throw new Error(
          `Shared dependency spec conflict for "${spec.name}": criticality disagrees between the core and ui lists`,
        );
      }
      continue;
    }
    byName.set(spec.name, spec);
  }
  return [...byName.values()];
})();

export interface SharedDependencyConfig {
  version: string;
  requiredVersion: string | false;
  singleton: boolean;
  strictVersion: boolean;
  eager: boolean;
  shareScope: string;
}

export type SharedDependencies = Record<string, SharedDependencyConfig>;

export type SharedConfigInput = {
  version: string;
  requiredVersion?: string | false;
  singleton?: boolean;
  strictVersion?: boolean;
  eager?: boolean;
  shareScope?: string;
};

export interface SharedDependencyResolutionOptions {
  /** the building workspace to resolve from; default is this module's own location */
  workspaceRoot?: string;
  resolution?: "package" | "subpath";
}

function searchedNote(target: string): string {
  return `require.resolve("${target}")`;
}

function findPackageJsonVersion(startDir: string, searched: string[]): string | null {
  let currentDir = startDir;
  for (let i = 0; i < 5; i += 1) {
    const packageJsonPath = join(currentDir, "package.json");
    searched.push(packageJsonPath);
    if (existsSync(packageJsonPath)) {
      try {
        const version = (JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string })
          .version;
        if (version) return version;
      } catch {}
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return null;
}

function resolveSubpathVersion(
  request: string,
  workspaceRoot: string | undefined,
  searched: string[],
): string | null {
  if (request.startsWith("@")) {
    throw new Error(
      `Scoped-package subpath "${request}" is not supported — subpath version resolution ` +
        `handles unscoped specifiers only (the known subpath specs, everything-dev/ui/*, are unscoped).`,
    );
  }
  const packageName = request.split("/")[0] ?? request;
  const subpath = request.split("/").slice(1).join("/");
  const candidates: string[] = [];
  if (workspaceRoot) {
    candidates.push(join(workspaceRoot, "node_modules", packageName, "package.json"));
  }
  const resolveRequests: Array<{ request: string; paths?: string[] }> = [
    { request: `${packageName}/${subpath}`, ...(workspaceRoot ? { paths: [workspaceRoot] } : {}) },
    { request: `${packageName}/${subpath}` },
    {
      request: `${packageName}/package.json`,
      ...(workspaceRoot ? { paths: [workspaceRoot] } : {}),
    },
    { request: `${packageName}/package.json` },
  ];
  for (const { request: target, paths } of resolveRequests) {
    try {
      const resolved = require.resolve(target, paths ? { paths } : undefined);
      searched.push(resolved);
      candidates.push(
        resolved.endsWith("package.json")
          ? resolved
          : resolve(dirname(resolved), "..", "..", "package.json"),
      );
    } catch {
      searched.push(searchedNote(target));
    }
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const version = (JSON.parse(readFileSync(candidate, "utf8")) as { version?: string }).version;
      if (version) return version;
    } catch {}
  }
  return null;
}

export function resolveSharedVersion(
  name: string,
  options: SharedDependencyResolutionOptions = {},
): string {
  const searched: string[] = [];
  const { workspaceRoot, resolution = "package" } = options;

  if (resolution === "subpath") {
    const version = resolveSubpathVersion(name, workspaceRoot, searched);
    if (version) return version;
    throw new SharedDependencyResolutionError(name, searched);
  }

  const roots: Array<string | undefined> = workspaceRoot ? [workspaceRoot, undefined] : [undefined];
  for (const root of roots) {
    try {
      const resolved = root ? require.resolve(name, { paths: [root] }) : require.resolve(name);
      searched.push(resolved);
      const version = findPackageJsonVersion(dirname(resolved), searched);
      if (version) return version;
    } catch {
      searched.push(searchedNote(name));
    }
  }
  throw new SharedDependencyResolutionError(name, searched);
}

function resolveOwnVersion(searched: string[]): string {
  const localPackageJson = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  searched.push(localPackageJson);
  if (existsSync(localPackageJson)) {
    try {
      const version = (JSON.parse(readFileSync(localPackageJson, "utf8")) as { version?: string })
        .version;
      if (version) return version;
    } catch {}
  }
  try {
    const resolved = require.resolve("every-plugin/package.json");
    searched.push(resolved);
    const version = (JSON.parse(readFileSync(resolved, "utf8")) as { version?: string }).version;
    if (version) return version;
  } catch {
    searched.push(searchedNote("every-plugin/package.json"));
  }
  throw new SharedDependencyResolutionError("every-plugin", searched);
}

export function shareConfigFor(
  spec: SharedDependencySpec,
  version: string,
): Omit<SharedDependencyConfig, "version"> {
  return spec.critical
    ? {
        requiredVersion: version,
        singleton: true,
        strictVersion: true,
        eager: false,
        shareScope: "default",
      }
    : {
        requiredVersion: false,
        singleton: true,
        strictVersion: false,
        eager: false,
        shareScope: "default",
      };
}

export interface SharedDepsBuildOptions {
  /** the every-plugin share version; default resolves the installed package.json */
  ownVersion?: string;
}

function specVersion(spec: SharedDependencySpec, options: SharedDepsBuildOptions): string {
  if (spec.resolution === "self") {
    return options.ownVersion ?? resolveOwnVersion([`own package.json of "${spec.name}"`]);
  }
  return resolveSharedVersion(spec.name, {
    resolution: spec.resolution === "subpath" ? "subpath" : "package",
  });
}

export function getPluginSharedDependencies(
  options: SharedDepsBuildOptions = {},
): SharedDependencies {
  return Object.fromEntries(
    CORE_SHARED_DEPS.map((spec) => {
      const version = specVersion(spec, options);
      return [spec.name, { version, ...shareConfigFor(spec, version) }];
    }),
  );
}

export interface HostSharedEntry {
  version: string;
  shareScope: string;
  shareConfig: {
    singleton: boolean;
    requiredVersion: string | false;
    strictVersion: boolean;
    eager: boolean;
  };
}

export function toHostSharedEntry(name: string, config: SharedConfigInput): HostSharedEntry {
  const normalized = normalizeSharedConfig(config, name);
  return {
    version: normalized.version,
    shareScope: normalized.shareScope,
    shareConfig: {
      singleton: normalized.singleton,
      requiredVersion: normalized.requiredVersion,
      strictVersion: normalized.strictVersion,
      eager: normalized.eager,
    },
  };
}

/**
 * The runtime mf-config's core shared map: the same entries
 * `getPluginSharedDependencies` assembles, shaped through the one host mapper
 * (`toHostSharedEntry`) so both consumers derive from a single entry type.
 */
export function buildMfCoreSharedDependencies(
  options: SharedDepsBuildOptions = {},
): Record<string, HostSharedEntry> {
  return Object.fromEntries(
    Object.entries(getPluginSharedDependencies(options)).map(([name, config]) => [
      name,
      toHostSharedEntry(name, config),
    ]),
  );
}

export interface UiSharedDepEntry {
  version: string;
  requiredVersion: string | false;
  singleton: true;
  strictVersion: boolean;
  eager: false;
  shareScope: "default";
  /** consumer role only: no bundled fallback copy — the provider provides */
  import?: false;
}

export interface UiSharedDepsOptions {
  /** explicit core-shell parity opt-out; default is the strict singleton */
  strictVersion?: boolean;
  role?: "provider" | "consumer";
  workspaceRoot?: string;
  dependencies?: Record<string, string>;
}

export function createUiSharedDeps(
  options: UiSharedDepsOptions = {},
): Record<string, UiSharedDepEntry> {
  const deps: Record<string, UiSharedDepEntry> = {};
  for (const spec of UI_SHARED_DEPS) {
    if ("optional" in spec && spec.optional && !options.dependencies?.[spec.name]) continue;
    const version = resolveSharedVersion(spec.name, {
      workspaceRoot: options.workspaceRoot,
      resolution: spec.resolution === "subpath" ? "subpath" : "package",
    });
    const strict = options.strictVersion !== false;
    deps[spec.name] = {
      version,
      requiredVersion: strict ? version : false,
      singleton: true,
      strictVersion: strict,
      eager: false,
      shareScope: "default",
      ...(options.role === "consumer" ? { import: false as const } : {}),
    };
  }
  return deps;
}

const UNRESOLVED_VERSIONS = new Set(["*", "latest", ""]);

export function assertResolvedSharedVersion(name: string, version: unknown): string {
  if (typeof version !== "string" || UNRESOLVED_VERSIONS.has(version.trim())) {
    throw new SharedDependencyResolutionError(name, [
      `declared version ${JSON.stringify(version ?? null)} is not resolvable — "*", "latest", and empty fail loudly instead of disabling the strict-singleton guard`,
    ]);
  }
  return version;
}

export function normalizeSharedConfig(
  config: SharedConfigInput,
  name: string,
): SharedDependencyConfig {
  const version = assertResolvedSharedVersion(name, config.version);
  return {
    version,
    requiredVersion: config.requiredVersion ?? false,
    singleton: config.singleton ?? false,
    strictVersion: config.strictVersion ?? false,
    eager: config.eager ?? false,
    shareScope: config.shareScope ?? "default",
  };
}

function comparableSharedConfig(config: SharedConfigInput) {
  return {
    version: config.version,
    requiredVersion: config.requiredVersion ?? false,
    singleton: config.singleton ?? false,
    strictVersion: config.strictVersion ?? false,
    eager: config.eager ?? false,
    shareScope: config.shareScope ?? "default",
  };
}

export function isSameSharedConfig(a: SharedConfigInput, b: SharedConfigInput): boolean {
  const left = comparableSharedConfig(a);
  const right = comparableSharedConfig(b);
  return (
    left.version === right.version &&
    left.requiredVersion === right.requiredVersion &&
    left.singleton === right.singleton &&
    left.strictVersion === right.strictVersion &&
    left.eager === right.eager &&
    left.shareScope === right.shareScope
  );
}

export function mergeSharedMaps(
  ...maps: Array<Record<string, SharedConfigInput> | undefined>
): Record<string, SharedDependencyConfig> {
  const merged: Record<string, SharedDependencyConfig> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [name, config] of Object.entries(map)) {
      const normalized = normalizeSharedConfig(config, name);
      const existing = merged[name];
      if (existing && !isSameSharedConfig(existing, normalized)) {
        throw new Error(
          `Conflicting shared dependency "${name}" in shared dependency configuration`,
        );
      }
      merged[name] = normalized;
    }
  }
  return merged;
}
