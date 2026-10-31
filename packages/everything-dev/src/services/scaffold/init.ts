import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { execa } from "execa";
import { glob } from "glob";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { loadAppDescriptorConfig } from "../../config";
import type { OverrideSection } from "../../contract";
import { serializeAppDescriptorSource } from "../../descriptor/serialize";
import type { BosConfigInput, ParentStarterConfig, StarterLevel } from "../../types";
import { saveBosConfig } from "../../utils/save-config";
import { computeSnapshotHash as computeHash } from "../../utils/snapshot-hash";
import {
  buildAuthContractStub,
  buildAuthExportStub,
  buildAuthTypesGenContent,
} from "../codegen/auth-types";
import {
  loadManifestNormalizationSpec,
  normalizePackageManifestsInTree,
} from "../registry/manifest-normalizer";
import { resolveCatalogChainSource } from "../resolution/init-source";
import { writeSnapshot } from "./snapshot";

export {
  type CatalogChainSource,
  downloadTarball,
  fetchParentConfig,
  parseGitHubUrl,
  releaseRefCandidates,
  resolveCatalogChainSource,
  resolveRepositoryViaExtendsChain,
  resolveSourceDir,
  type SourceResult,
} from "../resolution/init-source";

export const PNPM_PACKAGE_MANAGER = "pnpm@12.10.1";

/**
 * Transitive-singleton overrides every workspace in the fleet must agree on
 * (ticket 05's deviation log: isolated resolution splits better-auth
 * peer-context identities across the plugin fleet). Values derive from the
 * catalog so sync keeps them current; keys absent from the catalog are left
 * unpinned.
 */
const CHILD_OVERRIDE_KEYS = [
  "@better-fetch/fetch",
  "@rspack/core",
  "better-auth",
  "react",
  "react-dom",
] as const;

/**
 * The child's workspace manifest: pnpm-workspace.yaml is canonical (v2, ADR
 * 0026) — packages globs synthesized from the child's override sections, the
 * catalog merged over any local entry, plus the fleet-wide linker posture and
 * singleton overrides. Re-running (sync/upgrade) merges instead of clobbering.
 */
export function writeChildWorkspaceYaml(
  projectDir: string,
  next: { packages: string[]; catalog: Record<string, string> },
): boolean {
  const yamlPath = join(projectDir, "pnpm-workspace.yaml");
  let doc: {
    packages?: string[];
    catalog?: Record<string, string>;
    nodeLinker?: string;
    linkWorkspacePackages?: boolean;
    ignoreScripts?: boolean;
    overrides?: Record<string, string>;
  } = {};
  if (existsSync(yamlPath)) {
    try {
      const parsed = parseYaml(readFileSync(yamlPath, "utf-8"));
      if (parsed && typeof parsed === "object") doc = parsed;
    } catch {
      doc = {};
    }
  }

  let changed = !existsSync(yamlPath);
  const packages = [...new Set([...(doc.packages ?? []), ...next.packages])].sort();
  if (JSON.stringify(packages) !== JSON.stringify(doc.packages)) {
    doc.packages = packages;
    changed = true;
  }

  const catalog: Record<string, string> = { ...doc.catalog };
  for (const [name, version] of Object.entries(next.catalog)) {
    if (catalog[name] !== version) {
      catalog[name] = version;
      changed = true;
    }
  }
  if (
    Object.keys(catalog).length > 0 &&
    Object.keys(catalog).length !== Object.keys(doc.catalog ?? {}).length
  ) {
    changed = true;
  }
  if (changed || !doc.catalog) {
    doc.catalog = Object.fromEntries(
      Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  if (doc.nodeLinker !== "hoisted") {
    doc.nodeLinker = "hoisted";
    changed = true;
  }
  if (doc.linkWorkspacePackages !== true) {
    doc.linkWorkspacePackages = true;
    changed = true;
  }
  if (doc.ignoreScripts !== true) {
    doc.ignoreScripts = true;
    changed = true;
  }

  const overrides: Record<string, string> = { ...doc.overrides };
  for (const key of CHILD_OVERRIDE_KEYS) {
    if (catalog[key] && overrides[key] !== catalog[key]) {
      overrides[key] = catalog[key];
      changed = true;
    }
  }
  if (Object.keys(overrides).length > 0) {
    doc.overrides = Object.fromEntries(
      Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  if (changed) {
    writeFileSync(yamlPath, `${stringifyYaml(doc, { lineWidth: 0 }).trimEnd()}\n`);
    return true;
  }
  return false;
}

/**
 * Init must never reuse a lockfile left in the target (copied from a parent
 * checkout or left by a previous run) — stale framework resolutions would
 * survive the fresh install. Bun's bun.lock is deleted on sight (ADR 0026's
 * silent-revert footgun); the child's own pnpm-lock.yaml is re-resolved.
 */
export function removeStrayLockfiles(projectDir: string): void {
  for (const lockfile of ["pnpm-lock.yaml", "bun.lock"]) {
    const lockfilePath = join(projectDir, lockfile);
    if (existsSync(lockfilePath)) {
      rmSync(lockfilePath, { force: true });
    }
  }
}

export const INIT_ROOT_PATTERNS = [
  "bos.config.json",
  "package.json",
  ".env.example",
  ".gitignore",
  "biome.json",
  "AGENTS.md",
  ".agents/skills/**",
  "skills-lock.json",
  "docs/agents/**",
  "README.md",
  "CONTRIBUTING.md",
  ".github/templates/**",
] as const;

const OVERRIDE_WORKSPACE_MAP: Record<OverrideSection, string[]> = {
  ui: ["ui"],
  api: ["api"],
  host: ["host"],
  plugins: [],
};

export function buildInitPatterns(
  overrides: OverrideSection[],
  plugins?: string[],
  pluginDirMap?: Record<string, string>,
): string[] {
  const has = (section: OverrideSection) => overrides.includes(section);
  const patterns: string[] = [...INIT_ROOT_PATTERNS];

  if (has("ui")) patterns.push("ui/**");
  if (has("api")) patterns.push(API_TEMPLATE_PATTERN);
  if (has("host")) patterns.push("host/**");
  if (has("plugins")) {
    for (const plugin of plugins ?? []) {
      const dirName = pluginDirMap?.[plugin] ?? plugin;
      patterns.push(`plugins/${dirName}/**`);
    }
  }

  return patterns;
}

/** api-override children get the slim generic shell, never the parent's domain API. */
const API_TEMPLATE_PATTERN = ".github/templates/api/**";

export function isApiTemplatePath(filePath: string): boolean {
  return filePath.startsWith(".github/templates/api/");
}

export function buildPluginRouteExclusions(
  parentConfig: { plugins?: Record<string, unknown> } | null | undefined,
  selectedPlugins: string[],
): string[] {
  if (!parentConfig?.plugins) return [];

  const selected = new Set(selectedPlugins);
  const claimedBySelected = new Set<string>();
  const claimedByUnselected: string[] = [];

  for (const [pluginKey, entry] of Object.entries(parentConfig.plugins)) {
    const routes = extractPluginRoutes(entry);
    if (!routes) continue;

    if (selected.has(pluginKey)) {
      for (const route of routes) claimedBySelected.add(route);
    } else {
      for (const route of routes) claimedByUnselected.push(route);
    }
  }

  return claimedByUnselected.filter((route) => !claimedBySelected.has(route));
}

const STARTER_PRODUCT_EXCLUSIONS = [
  "_public/explore.tsx",
  "_public/stake.tsx",
  "_public/n/**",
  "_public/$accountId.tsx",
  "_public/$accountId/**",
  "_public/activity/**",
  "_public/-stake-*",
  "_authenticated/_dashboard/dashboard/node/**",
  "_authenticated/_dashboard/nodes/**",
  "_authenticated/_dashboard/tenant.*",
  "_authenticated/_dashboard/discover.tsx",
  "_authenticated/_dashboard/apply.tsx",
  "_authenticated/_dashboard/prototype-staking-poc.tsx",
  "_authenticated/onboarding/**",
  "_admin/_dashboard/_dashboard/admin/nodes/**",
  "_admin/_dashboard/_dashboard/admin/proposals/**",
  "_admin/_dashboard/_dashboard/admin/tenants/**",
  "_admin/_dashboard/_dashboard/admin/relayer.tsx",
  "_admin/_dashboard/_dashboard/admin/organizations.tsx",
] as const;

const STARTER_SIMPLE_EXCLUSIONS = [
  "_authenticated.tsx",
  "_authenticated/**",
  "_admin.tsx",
  "_admin/**",
] as const;

/**
 * Route-file globs (relative to the child's `ui/src/routes/`) that a starter
 * of the given level must not receive. Parent `starter` config can add
 * exclusions (`exclude`, `levels[level].exclude`) or reclaim routes for a
 * level (`levels[level].include`). Entries are prefixed with
 * `ui/src/routes/` so they compose with `copyFilteredFiles`'s ignore list.
 */
export function buildStarterRouteExclusions(
  level: StarterLevel,
  parentConfig: { starter?: ParentStarterConfig | StarterLevel } | null | undefined,
): string[] {
  const excluded = new Set<string>(STARTER_PRODUCT_EXCLUSIONS);
  if (level === "simple") {
    for (const entry of STARTER_SIMPLE_EXCLUSIONS) excluded.add(entry);
  }

  const starter = parentConfig?.starter;
  if (starter && typeof starter === "object") {
    for (const entry of starter.exclude ?? []) excluded.add(entry);
    const levelConfig = starter.levels?.[level];
    if (levelConfig) {
      for (const entry of levelConfig.exclude ?? []) excluded.add(entry);
      for (const entry of levelConfig.include ?? []) excluded.delete(entry);
    }
  }

  return [...excluded].map((entry) => `ui/src/routes/${entry}`);
}

function extractPluginRoutes(entry: unknown): string[] | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const routes = (entry as { routes?: unknown }).routes;
  if (!Array.isArray(routes)) return undefined;
  return routes.filter((r): r is string => typeof r === "string");
}

export function sourcePathToDestinationPath(filePath: string): string {
  if (isApiTemplatePath(filePath)) {
    return filePath.replace(/^\.github\/templates\/api\//, "api/");
  }
  return filePath.startsWith(".github/templates/")
    ? filePath.replace(/^\.github\/templates\//, ".github/")
    : filePath;
}

export async function detectGitRemoteUrl(directory: string): Promise<string | undefined> {
  try {
    const { stdout } = await execa("git", ["remote", "get-url", "origin"], {
      cwd: directory,
      stdio: "pipe",
    });
    const url = stdout.trim();
    if (!url) return undefined;
    return normalizeGitUrl(url);
  } catch {
    return undefined;
  }
}

function normalizeGitUrl(url: string): string | undefined {
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
  }
  const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`;
  }
  return url.endsWith(".git") ? url.slice(0, -4) : url;
}

export async function copyFilteredFiles(
  sourceDir: string,
  destination: string,
  patterns: string[],
  options: {
    overrides: OverrideSection[];
    plugins?: string[];
    ignore?: string[];
  },
): Promise<number> {
  if (patterns.length === 0) {
    return 0;
  }

  const baseIgnore = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.bos/**"];
  const ignore = options.ignore ? [...baseIgnore, ...options.ignore] : baseIgnore;

  const allFiles = new Set<string>();
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: sourceDir,
      nodir: true,
      dot: true,
      absolute: false,
      ignore,
    });
    for (const match of matches) {
      allFiles.add(match);
    }
  }
  if (!options.overrides.includes("api")) {
    for (const match of allFiles) {
      if (isApiTemplatePath(match)) allFiles.delete(match);
    }
  }

  mkdirSync(destination, { recursive: true });

  let count = 0;
  for (const filePath of allFiles) {
    const src = join(sourceDir, filePath);
    const stat = lstatSync(src);
    if (!stat.isFile()) continue;

    const destPath = sourcePathToDestinationPath(filePath);
    const dest = join(destination, destPath);
    mkdirSync(dirname(dest), { recursive: true });
    const content = readFileSync(src);
    writeFileSync(dest, content);
    count++;
  }

  return count;
}

function stripProductionFields(entry: Record<string, unknown>): void {
  delete entry.production;
  delete entry.integrity;
  delete entry.ssr;
  delete entry.ssrIntegrity;
  delete entry.pin;
}

/**
 * Scaffold the authored config as the TS form: the personalized
 * bos.config.json materializes into an authored `bos.app.ts` descriptor and
 * the JSON copy is removed — publish/sync still canonicalize to JSON for
 * FastKV from the resolved config. Returns the config that was converted, so
 * callers that need it (before the child has node_modules to import the
 * descriptor) can pass it onward.
 */
export async function convertChildConfigToAppForm(
  destination: string,
): Promise<BosConfigInput | null> {
  const configPath = join(destination, "bos.config.json");
  if (!existsSync(configPath)) return null;
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as BosConfigInput;
  writeFileSync(join(destination, "bos.app.ts"), serializeAppDescriptorSource(config));
  rmSync(configPath);
  return config;
}

/**
 * Scaffold the root dev-overlay starter (`bos.dev.ts`). Idempotent — never
 * overwrites an existing overlay. Dev overlays are merged child-wins over
 * the resolved config in development and are never published.
 */
export function writeDevOverlayTemplate(
  destination: string,
  opts: { extendsRef?: string } = {},
): void {
  const overlayPath = join(destination, "bos.dev.ts");
  if (existsSync(overlayPath)) return;
  const extendsLine = opts.extendsRef ? `\n// Inherited base: ${opts.extendsRef}\n` : "";
  writeFileSync(
    overlayPath,
    `import type { AppDescriptor } from "everything-dev/descriptor";
${extendsLine}
/**
 * Development-only overlay for bos.app.ts — merged child-wins over the
 * resolved config when the environment is development. Never published.
 * Example: pin the auth attachment to a running dev server instead of
 * letting the dev harness spawn it.
 */
export default {
  // auth: { development: "http://localhost:3006" },
} satisfies Partial<AppDescriptor>;
`,
  );
}

function buildRootTypecheckScript(sections: {
  ui: boolean;
  api: boolean;
  host: boolean;
  plugins: boolean;
}): string {
  const commands = ["pnpm run types:gen"];

  if (sections.ui) {
    commands.push("if [ -d ui ]; then pnpm --dir ui run typecheck; fi");
  }
  if (sections.api) {
    commands.push("if [ -d api ]; then pnpm --dir api run typecheck; fi");
  }
  if (sections.host) {
    commands.push("if [ -d host ]; then pnpm --dir host run typecheck; fi");
  }
  if (sections.plugins) {
    commands.push(
      'if [ -d plugins ]; then for dir in plugins/*; do if [ -f "$dir/package.json" ]; then pnpm --dir "$dir" --if-present run typecheck && pnpm --dir "$dir" --if-present run typecheck:ui; fi; done; fi',
    );
  }

  return commands.join(" && ");
}

export function getParentOnlyScriptKeys(projectDir: string): string[] {
  const parentPkgPath = join(projectDir, "node_modules", "everything-dev", "package.json");
  if (!existsSync(parentPkgPath)) return [];

  try {
    const parentPkg = JSON.parse(readFileSync(parentPkgPath, "utf-8")) as Record<string, unknown>;
    const parentScripts = (parentPkg.scripts ?? {}) as Record<string, string>;

    const allChildKeys = new Set(
      Object.keys(buildChildRootScripts({ ui: true, api: true, host: true, plugins: true })),
    );
    allChildKeys.add("test:integration");

    return Object.keys(parentScripts).filter((key) => !allChildKeys.has(key));
  } catch {
    return [];
  }
}

/**
 * The child root manifest carries exactly the framework packages plus the
 * optional peers whose absence trips bundler warnings: `@better-auth/core`
 * optionally peers `@opentelemetry/api`, pnpm does not auto-install optional
 * peers, and nothing else in the child resolves it — undeclared, every child
 * build warns "Module not found: Can't resolve '@opentelemetry/api'".
 */
export function childFrameworkDependencies(): Record<string, string> {
  return {
    "everything-dev": "catalog:",
    "every-plugin": "catalog:",
    "@opentelemetry/api": "catalog:",
  };
}

export function buildChildRootScripts(sections: {
  ui: boolean;
  api: boolean;
  host: boolean;
  plugins: boolean;
}): Record<string, string> {
  const scripts: Record<string, string> = {
    dev: "bos dev",
    "dev:proxy": "bos dev --proxy",
    build: "bos build",
    deploy: "bos deploy",
    publish: "bos publish",
    start: "bos start",
    typecheck: buildRootTypecheckScript(sections),
    lint: "biome check .",
    "lint:fix": "biome check --write .",
    format: "biome format --write .",
    "format:check": "biome format .",
    "types:gen": "bos types gen",
    bos: "bos",
  };

  if (sections.api) {
    scripts["db:push"] = "pnpm --dir api exec drizzle-kit push";
    scripts["db:studio"] = "bos db:studio";
    scripts["db:doctor"] = "bos db:doctor";
    scripts["db:repair"] = "bos db:repair";
    scripts["db:generate"] = "pnpm --dir api exec drizzle-kit generate";
    scripts["db:migrate"] = "pnpm --dir api exec drizzle-kit migrate";
    scripts["test:api"] = "pnpm --dir api --if-present run test";
    scripts["test:integration"] = "pnpm --dir api --if-present run test tests/integration/";
  }

  if (sections.host) {
    scripts["test:e2e"] = "pnpm --dir host --if-present run test";
  }

  const testTargets: string[] = [];
  if (sections.api) testTargets.push("pnpm --dir api --if-present run test");
  if (sections.host) testTargets.push("pnpm --dir host --if-present run test");
  if (sections.ui) testTargets.push("pnpm --dir ui --if-present run test");
  if (sections.plugins) {
    testTargets.push(
      'for d in plugins/*; do [ -f "$d/package.json" ] && pnpm --dir "$d" --if-present run test; done',
    );
  }
  scripts.test =
    testTargets.length > 0
      ? testTargets.join(" && ")
      : 'echo "No workspace directories configured"';

  // Scripts key off the child's own override selection (what it runs locally),
  // not off resolved-config secrets — a ui-only child gets none of these.
  if (sections.ui) {
    scripts["dev:ui"] = "bos dev --ui local --api remote";
  }
  if (sections.api) {
    scripts["dev:api"] = "bos dev --ui remote --api local";
  }

  return scripts;
}

function missingCatalogSource(): never {
  throw new Error(
    "No catalog source — pass `catalog` (the platform release manifest's) or `workspaceOpts.sourceDir` (a local release tree)",
  );
}

export async function personalizeConfig(
  destination: string,
  opts: {
    extendsAccount: string;
    extendsGateway: string;
    account?: string;
    domain?: string;
    plugins?: string[];
    overrides: OverrideSection[];
    pluginRoutes?: Record<string, string[]>;
    workspaceOpts?: { localOverrides?: boolean; sourceDir?: string };
    mode?: "init" | "sync";
    existingConfig?: Record<string, unknown>;
    repository?: string;
    title?: string;
    description?: string;
    testnet?: string;
    staging?: unknown;
    starter?: StarterLevel;
    /** The platform release's catalog (ADR 0034) — skips the local chain walk. */
    catalog?: Record<string, string>;
    /** The framework version to pin (ADR 0034) — stamped onto the authored
     * config; absent in sync mode, the child's existing pin is preserved. */
    platform?: string;
  },
): Promise<void> {
  const has = (section: OverrideSection) => opts.overrides.includes(section);
  const existingApp =
    opts.mode === "sync" && opts.existingConfig?.app && typeof opts.existingConfig.app === "object"
      ? (opts.existingConfig.app as Record<string, unknown>)
      : undefined;
  const preservedAuth = existingApp?.auth;
  const applyStarter = (config: Record<string, unknown>): void => {
    if (opts.starter) {
      config.starter = opts.starter;
    } else if (opts.mode !== "sync") {
      delete config.starter;
    }
  };
  const applyPlatformField = (config: Record<string, unknown>): void => {
    if (opts.platform !== undefined) {
      config.platform = opts.platform;
    } else if (opts.mode !== "sync") {
      delete config.platform;
    }
  };

  const explicitRootKeys = new Set(
    Object.entries(opts)
      .filter(
        ([key, value]) =>
          value !== undefined &&
          ![
            "extendsAccount",
            "extendsGateway",
            "plugins",
            "overrides",
            "pluginRoutes",
            "workspaceOpts",
            "mode",
            "existingConfig",
            "catalog",
            "platform",
          ].includes(key),
      )
      .map(([key]) => key),
  );

  const jsonConfigPath = join(destination, "bos.config.json");
  const appConfigPath = join(destination, "bos.app.ts");
  const tsForm = !existsSync(jsonConfigPath) && existsSync(appConfigPath);

  if (tsForm) {
    const config = (await loadAppDescriptorConfig(appConfigPath)) as Record<string, unknown>;

    config.extends = `bos://${opts.extendsAccount}/${opts.extendsGateway}`;

    if (opts.account) {
      config.account = opts.account;
    }
    if (opts.domain) {
      config.domain = opts.domain;
    }
    if (opts.repository) {
      config.repository = opts.repository;
    } else {
      delete config.repository;
    }

    const inheritableFields = ["title", "description", "testnet", "staging"] as const;
    for (const field of inheritableFields) {
      if (!(field in opts)) {
        delete config[field];
      }
    }

    applyStarter(config);
    applyPlatformField(config);

    if (config.app && typeof config.app === "object") {
      const app = config.app as Record<string, unknown>;

      for (const entryKey of Object.keys(app)) {
        if (
          !has(entryKey as OverrideSection) &&
          (entryKey === "host" || entryKey === "ui" || entryKey === "api")
        ) {
          delete app[entryKey];
          continue;
        }
        if (entryKey === "auth") {
          delete app[entryKey];
          continue;
        }
        const entry = app[entryKey];
        if (entry && typeof entry === "object") {
          stripProductionFields(entry as Record<string, unknown>);
        }
      }

      if (preservedAuth !== undefined) {
        app.auth = preservedAuth;
      }

      if (Object.keys(app).length === 0) {
        delete config.app;
      }
    }

    if (has("plugins")) {
      if (config.plugins && typeof config.plugins === "object") {
        const plugins = config.plugins as Record<string, unknown>;

        if (opts.plugins !== undefined) {
          for (const pluginKey of Object.keys(plugins)) {
            if (!opts.plugins.includes(pluginKey)) {
              delete plugins[pluginKey];
            }
          }
        }

        for (const pluginKey of Object.keys(plugins)) {
          const plugin = plugins[pluginKey];
          let pluginObj: Record<string, unknown>;

          if (typeof plugin === "string") {
            pluginObj = { extends: plugin };
            plugins[pluginKey] = pluginObj;
          } else if (plugin && typeof plugin === "object") {
            pluginObj = { ...(plugin as Record<string, unknown>) };
            plugins[pluginKey] = pluginObj;
          } else {
            continue;
          }

          stripProductionFields(pluginObj);
        }

        if (Object.keys(plugins).length === 0) {
          config.plugins = {};
        }
      }
    } else {
      config.plugins = {};
    }

    writeFileSync(appConfigPath, serializeAppDescriptorSource(config as BosConfigInput));
  }

  const configPath = join(destination, "bos.config.json");
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;

    config.extends = `bos://${opts.extendsAccount}/${opts.extendsGateway}`;

    if (opts.account) {
      config.account = opts.account;
    }
    if (opts.domain) {
      config.domain = opts.domain;
    }
    if (opts.repository) {
      config.repository = opts.repository;
    } else {
      delete config.repository;
    }

    const inheritableFields = ["title", "description", "testnet", "staging"] as const;
    for (const field of inheritableFields) {
      if (!(field in opts)) {
        delete config[field];
      }
    }

    applyStarter(config);
    applyPlatformField(config);

    if (config.app && typeof config.app === "object") {
      const app = config.app as Record<string, unknown>;

      for (const entryKey of Object.keys(app)) {
        if (
          !has(entryKey as OverrideSection) &&
          (entryKey === "host" || entryKey === "ui" || entryKey === "api")
        ) {
          delete app[entryKey];
          continue;
        }
        if (entryKey === "auth") {
          delete app[entryKey];
          continue;
        }
        const entry = app[entryKey];
        if (entry && typeof entry === "object") {
          stripProductionFields(entry as Record<string, unknown>);
        }
      }

      if (preservedAuth !== undefined) {
        app.auth = preservedAuth;
      }

      if (Object.keys(app).length === 0) {
        delete config.app;
      }
    }

    if (has("plugins")) {
      if (config.plugins && typeof config.plugins === "object") {
        const plugins = config.plugins as Record<string, unknown>;

        if (opts.plugins !== undefined) {
          for (const pluginKey of Object.keys(plugins)) {
            if (!opts.plugins.includes(pluginKey)) {
              delete plugins[pluginKey];
            }
          }
        }

        for (const pluginKey of Object.keys(plugins)) {
          const plugin = plugins[pluginKey];
          let pluginObj: Record<string, unknown>;

          if (typeof plugin === "string") {
            pluginObj = { extends: plugin };
            plugins[pluginKey] = pluginObj;
          } else if (plugin && typeof plugin === "object") {
            pluginObj = { ...(plugin as Record<string, unknown>) };
            plugins[pluginKey] = pluginObj;
          } else {
            continue;
          }

          stripProductionFields(pluginObj);
        }

        if (Object.keys(plugins).length === 0) {
          config.plugins = {};
        }
      }
    } else {
      config.plugins = {};
    }

    if (opts.mode === "sync" && opts.existingConfig) {
      // "platform" is managed (ADR 0034): the child's pin survives
      // personalization instead of being stripped as an unknown root key.
      const managedRootKeys = new Set([
        "extends",
        "account",
        "domain",
        "platform",
        "app",
        "plugins",
      ]);
      const preservedRootKeys = new Set([
        ...managedRootKeys,
        ...Object.keys(opts.existingConfig),
        ...explicitRootKeys,
      ]);

      for (const key of Object.keys(config)) {
        if (!preservedRootKeys.has(key)) {
          delete config[key];
        }
      }

      for (const [key, value] of Object.entries(opts.existingConfig)) {
        if (!(key in config) && !managedRootKeys.has(key) && !explicitRootKeys.has(key)) {
          config[key] = value;
        }
      }
    }

    await saveBosConfig(destination, config);
  }

  for (const relPath of ["ui/src/lib/api-types.gen.ts", "api/src/lib/plugins-types.gen.ts"]) {
    const absolutePath = join(destination, relPath);
    try {
      rmSync(absolutePath, { force: true });
    } catch {}
  }

  const pkgPath = join(destination, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    const childScripts = buildChildRootScripts({
      ui: has("ui"),
      api: has("api"),
      host: has("host"),
      plugins: has("plugins"),
    });

    if (typeof pkg.name !== "string" || pkg.name.length === 0) {
      pkg.name = "monorepo";
    }
    pkg.private = true;
    pkg.type = "module";
    pkg.packageManager = PNPM_PACKAGE_MANAGER;
    delete pkg.module;
    delete pkg.peerDependencies;
    delete pkg.patchedDependencies;

    const childWorkspaces: string[] = [];
    if (has("host")) childWorkspaces.push("host");
    if (has("ui")) childWorkspaces.push("ui");
    if (has("api")) childWorkspaces.push("api");
    if (has("plugins")) childWorkspaces.push("plugins/*");
    const localCatalog =
      pkg.workspaces && typeof pkg.workspaces === "object"
        ? ((pkg.workspaces as { catalog?: Record<string, string> }).catalog ?? {})
        : {};
    delete pkg.workspaces;

    if (!pkg.scripts || typeof pkg.scripts !== "object") {
      pkg.scripts = {};
    }
    const scripts = pkg.scripts as Record<string, string>;
    for (const [key, value] of Object.entries(childScripts)) {
      scripts[key] = value;
    }
    for (const obsoleteScript of [
      ...getParentOnlyScriptKeys(destination),
      "init",
      "prepare",
      "sync-catalog",
      // #572: children have no changesets — the release lever is root-only
      "changeset",
      "version",
      "release",
      "db:push",
      "db:studio",
      "db:doctor",
      "db:repair",
      "db:generate",
      "db:migrate",
      "test",
      "test:api",
      "test:integration",
      "test:e2e",
      "dev:ui",
      "dev:api",
    ]) {
      if (!(obsoleteScript in childScripts)) {
        delete scripts[obsoleteScript];
      }
    }

    if (pkg.devDependencies && typeof pkg.devDependencies === "object") {
      const deps = pkg.devDependencies as Record<string, string>;
      delete deps["every-plugin"];
      delete deps["everything-dev"];
    }

    const catalog: Record<string, string> = { ...localCatalog };

    // The copied root manifest is the parent's — a monorepo root whose
    // dependencies (workspace members, vendored links) do not exist in the
    // child. The child root carries exactly the framework packages.
    pkg.dependencies = childFrameworkDependencies();
    const deps = pkg.dependencies as Record<string, string>;
    const spec = opts.workspaceOpts?.sourceDir
      ? loadManifestNormalizationSpec(opts.workspaceOpts.sourceDir)
      : null;
    if (spec) {
      const rootCatalogEverythingDev = spec.rootCatalog["everything-dev"];
      const rootCatalogEveryPlugin = spec.rootCatalog["every-plugin"];
      if (rootCatalogEverythingDev) {
        catalog["everything-dev"] = rootCatalogEverythingDev;
      }
      if (rootCatalogEveryPlugin) {
        catalog["every-plugin"] = rootCatalogEveryPlugin;
      }
    }
    const frameworkCatalog = opts.catalog
      ? opts.catalog
      : opts.workspaceOpts?.sourceDir
        ? (
            await resolveCatalogChainSource({
              sourceDir: opts.workspaceOpts.sourceDir,
              originRef: `bos://${opts.extendsAccount}/${opts.extendsGateway}`,
            })
          ).catalog
        : missingCatalogSource();
    for (const [name, version] of Object.entries(frameworkCatalog)) {
      catalog[name] = version;
    }
    if (!deps["everything-dev"]) deps["everything-dev"] = "catalog:";
    if (!deps["every-plugin"]) deps["every-plugin"] = "catalog:";

    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    writeChildWorkspaceYaml(destination, { packages: childWorkspaces, catalog });
  }

  const apiTsConfigPath = join(destination, "api", "tsconfig.json");
  if (existsSync(apiTsConfigPath)) {
    const apiTsConfig = JSON.parse(readFileSync(apiTsConfigPath, "utf-8")) as {
      files?: string[];
      [key: string]: unknown;
    };
    if (apiTsConfig.files) {
      const validFiles = apiTsConfig.files.filter((f) => existsSync(join(destination, "api", f)));
      if (validFiles.length !== apiTsConfig.files.length) {
        if (validFiles.length === 0) {
          delete apiTsConfig.files;
        } else {
          apiTsConfig.files = validFiles;
        }
        writeFileSync(apiTsConfigPath, `${JSON.stringify(apiTsConfig, null, 2)}\n`);
      }
    }
  }

  await resolveWorkspaceRefs(destination, opts.workspaceOpts);

  if (has("ui")) {
    const genContractPath = join(destination, "ui", "src", "lib", "api-types.gen.ts");
    if (!existsSync(genContractPath)) {
      mkdirSync(dirname(genContractPath), { recursive: true });
      writeFileSync(genContractPath, `export type ApiContract = Record<string, never>;\n`);
    }

    const publicDir = join(destination, "ui", "public");
    if (!existsSync(publicDir)) {
      mkdirSync(publicDir, { recursive: true });
    }

    const llmsTxtPath = join(publicDir, "llms.txt");
    if (!existsSync(llmsTxtPath)) {
      const title = opts.title ?? opts.account ?? "app";
      writeFileSync(llmsTxtPath, buildChildLlmsTxt(title));
    }

    const skillMdPath = join(publicDir, "skill.md");
    if (!existsSync(skillMdPath)) {
      const title = opts.title ?? opts.account ?? "app";
      const repository = opts.repository ?? "";
      writeFileSync(skillMdPath, buildChildSkillMd(title, repository));
    }

    for (const agentFilePath of [llmsTxtPath, skillMdPath]) {
      const content = readFileSync(agentFilePath, "utf-8");
      if (content.includes(WORKFLOW_SKILLS_MARKER)) continue;
      writeFileSync(agentFilePath, `${content.replace(/\n*$/, "\n")}${WORKFLOW_SKILLS_NOTE}`);
    }
  }

  if (has("api")) {
    const pluginsClientGenPath = join(destination, "api", "src", "lib", "plugins-types.gen.ts");
    if (!existsSync(pluginsClientGenPath)) {
      mkdirSync(dirname(pluginsClientGenPath), { recursive: true });
      writeFileSync(
        pluginsClientGenPath,
        `import type { RouterContractClient, RouterContract } from "@orpc/contract";\ntype ClientFactory<C extends RouterContract> = (context?: Record<string, unknown>) => RouterContractClient<C>;\nexport type PluginsClient = Record<string, never>;\n`,
      );
    }
  }

  const authTypesPaths: string[] = [];
  if (has("ui")) {
    authTypesPaths.push(join(destination, "ui", "src", "lib", "auth-types.gen.ts"));
  }
  if (has("api")) {
    authTypesPaths.push(join(destination, "api", "src", "lib", "auth-types.gen.ts"));
  }
  if (has("host") && existsSync(join(destination, "host", "src"))) {
    authTypesPaths.push(join(destination, "host", "src", "lib", "auth-types.gen.ts"));
  }
  for (const authTypesGenPath of authTypesPaths) {
    if (!existsSync(authTypesGenPath)) {
      mkdirSync(dirname(authTypesGenPath), { recursive: true });
      const authExportRel = toRelativeImportPath(
        join(destination, ".bos", "generated", "auth", "auth-export.d.ts"),
        authTypesGenPath,
      );
      const contractRel = toRelativeImportPath(
        join(destination, ".bos", "generated", "auth", "contract.d.ts"),
        authTypesGenPath,
      );
      writeFileSync(authTypesGenPath, buildAuthTypesGenContent(authExportRel, contractRel));
    }
  }

  if (authTypesPaths.length > 0) {
    const authDir = join(destination, ".bos", "generated", "auth");
    if (!existsSync(authDir)) {
      mkdirSync(authDir, { recursive: true });
    }
    const authExportStubPath = join(authDir, "auth-export.d.ts");
    if (!existsSync(authExportStubPath)) {
      writeFileSync(authExportStubPath, buildAuthExportStub());
    }
    const contractStubPath = join(authDir, "contract.d.ts");
    if (!existsSync(contractStubPath)) {
      writeFileSync(contractStubPath, buildAuthContractStub());
    }
  }

  if (has("plugins")) {
    for (const plugin of opts.plugins ?? []) {
      const pluginSrcDir = join(destination, "plugins", plugin, "src");
      const pluginIndexPath = join(pluginSrcDir, "index.ts");
      const pluginClientGenPath = join(pluginSrcDir, "lib", "plugins-client.gen.ts");
      if (!existsSync(pluginIndexPath) || existsSync(pluginClientGenPath)) {
        continue;
      }
      const pluginIndex = readFileSync(pluginIndexPath, "utf-8");
      if (!pluginIndex.includes("./lib/plugins-client.gen")) {
        continue;
      }
      writeFileSync(pluginClientGenPath, "export type PluginsClient = Record<string, never>;\n");
    }
  }
}

function toRelativeImportPath(fromPath: string, toPath: string): string {
  const rel = relative(dirname(toPath), fromPath);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export async function runPnpmInstall(
  destination: string,
  opts?: {
    spinner?: { message: (msg: string) => void };
  },
): Promise<void> {
  await runWithProgress(
    "pnpm",
    ["install", "--ignore-scripts"],
    destination,
    opts?.spinner,
    "Installing dependencies",
  );
}

export async function runPnpmInstallForUpgrade(
  destination: string,
  opts?: {
    spinner?: { message: (msg: string) => void };
  },
): Promise<void> {
  await runWithProgress(
    "pnpm",
    ["install", "--force"],
    destination,
    opts?.spinner,
    "Installing dependencies",
  );
}

export async function runTypesGen(
  destination: string,
  opts?: {
    spinner?: { message: (msg: string) => void };
    remotePlugins?: string[];
  },
): Promise<void> {
  const bosModule = join(destination, "node_modules", "everything-dev", "dist", "cli.mjs");
  if (existsSync(bosModule)) {
    const args = [bosModule, "types", "gen"];
    if (opts?.remotePlugins && opts.remotePlugins.length > 0) {
      args.push("--remote-plugins", opts.remotePlugins.join(","));
    }
    await runWithProgress(process.execPath, args, destination, opts?.spinner, "Generating types");
    return;
  }

  throw new Error("Unable to locate bos CLI for types generation");
}

async function runWithProgress(
  command: string,
  args: string[],
  cwd: string,
  spinner: { message: (msg: string) => void } | undefined,
  label: string,
): Promise<void> {
  const timeout = COMMAND_TIMEOUTS[command] ?? 2 * 60_000;
  const child = execa(command, args, {
    cwd,
    stdio: "inherit",
    timeout,
    env: { ...process.env, BOS_NO_BANNER: "1" },
  });

  if (spinner) {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.round((Date.now() - start) / 1000);
      spinner.message(`${label}... (${elapsed}s)`);
    }, 2000);
    try {
      await child;
    } finally {
      clearInterval(interval);
    }
  } else {
    await child;
  }
}

export async function scaffoldMinimalProject(
  destination: string,
  parentConfig: BosConfigInput,
  opts: {
    extendsAccount: string;
    extendsGateway: string;
    account?: string;
    domain?: string;
    plugins?: string[];
    overrides: OverrideSection[];
    repository?: string;
    title?: string;
    description?: string;
    starter?: StarterLevel;
    /** local parent source dir — resolves the catalog offline (tests, --source) */
    catalogSourceDir?: string;
    /** the platform release's catalog (ADR 0034) — preferred over the walk */
    catalog?: Record<string, string>;
    /** the framework version to pin (ADR 0034) */
    platform?: string;
  },
): Promise<number> {
  mkdirSync(destination, { recursive: true });

  const has = (section: OverrideSection) => opts.overrides.includes(section);

  const config: Record<string, unknown> = {
    extends: `bos://${opts.extendsAccount}/${opts.extendsGateway}`,
    account: opts.account || opts.extendsAccount,
    ...(opts.domain ? { domain: opts.domain } : {}),
    ...(opts.repository ? { repository: opts.repository } : {}),
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.starter ? { starter: opts.starter } : {}),
    ...(opts.platform ? { platform: opts.platform } : {}),
  };

  if (parentConfig.app && typeof parentConfig.app === "object") {
    const app: Record<string, unknown> = {};
    const parentApp = parentConfig.app as Record<string, Record<string, unknown>>;

    if (has("host") && parentApp.host) {
      app.host = { ...parentApp.host };
      stripProductionFields(app.host as Record<string, unknown>);
    }

    if (has("ui") && parentApp.ui) {
      app.ui = { ...parentApp.ui };
      stripProductionFields(app.ui as Record<string, unknown>);
    }

    if (has("api") && parentApp.api) {
      app.api = { ...parentApp.api };
      stripProductionFields(app.api as Record<string, unknown>);
    }

    if (Object.keys(app).length > 0) {
      config.app = app;
    }
  }

  if (has("plugins") && opts.plugins && opts.plugins.length > 0 && parentConfig.plugins) {
    const plugins: Record<string, unknown> = {};
    for (const key of opts.plugins) {
      const parentPlugin = (parentConfig.plugins as Record<string, unknown>)?.[key];
      if (parentPlugin) {
        if (typeof parentPlugin === "string") {
          plugins[key] = { extends: parentPlugin };
        } else {
          const pluginCopy = { ...(parentPlugin as Record<string, unknown>) };
          stripProductionFields(pluginCopy);
          plugins[key] = pluginCopy;
        }
      }
    }
    config.plugins = plugins;
  } else if (has("plugins")) {
    config.plugins = {};
  }

  await saveBosConfig(destination, config);

  const workspacePackages: string[] = [];
  for (const section of opts.overrides) {
    workspacePackages.push(...OVERRIDE_WORKSPACE_MAP[section]);
  }
  if (has("plugins")) {
    workspacePackages.push("plugins/*");
  }

  const catalog = opts.catalog
    ? { ...opts.catalog }
    : opts.catalogSourceDir
      ? (
          await resolveCatalogChainSource({
            sourceDir: opts.catalogSourceDir,
            originRef: `bos://${opts.extendsAccount}/${opts.extendsGateway}`,
          })
        ).catalog
      : missingCatalogSource();

  const pkg: Record<string, unknown> = {
    name: "monorepo",
    private: true,
    type: "module",
    packageManager: PNPM_PACKAGE_MANAGER,
    scripts: buildChildRootScripts({
      ui: has("ui"),
      api: has("api"),
      host: has("host"),
      plugins: has("plugins"),
    }),
    dependencies: childFrameworkDependencies(),
    devDependencies: {},
  };
  writeFileSync(join(destination, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  writeChildWorkspaceYaml(destination, { packages: workspacePackages, catalog });

  writeFileSync(join(destination, ".gitignore"), generateGitignore());

  return 4;
}

async function resolveWorkspaceRefs(
  destination: string,
  options?: { localOverrides?: boolean; sourceDir?: string },
): Promise<void> {
  await normalizePackageManifestsInTree({
    sourceRootDir: options?.sourceDir ?? destination,
    targetDir: destination,
    resolveCatalogRefs: false,
    preserveCatalogRefs: true,
    removeWorkspaceDeps: ["host"],
  });
}

export async function writeInitSnapshot(
  destination: string,
  _extendsAccount: string,
  _extendsGateway: string,
  sourceDir: string,
  patterns: string[],
  options: {
    overrides: OverrideSection[];
    plugins?: string[];
    ignore?: string[];
    starter?: StarterLevel;
  },
): Promise<void> {
  const baseIgnore = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.bos/**"];
  const ignore = options.ignore ? [...baseIgnore, ...options.ignore] : baseIgnore;

  const allFiles = new Set<string>();
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: sourceDir,
      nodir: true,
      dot: true,
      absolute: false,
      ignore,
    });
    for (const match of matches) {
      allFiles.add(match);
    }
  }
  if (!options.overrides.includes("api")) {
    for (const match of allFiles) {
      if (isApiTemplatePath(match)) allFiles.delete(match);
    }
  }

  const fileHashes: Record<string, string> = {};
  for (const filePath of allFiles) {
    const src = join(sourceDir, filePath);
    const stat = lstatSync(src);
    if (!stat.isFile()) continue;
    const destPath = sourcePathToDestinationPath(filePath);
    // Only snapshot what the scaffold actually delivered — files pruned
    // after copy (e.g. unused ui sources) must not come back via bos upgrade.
    if (!existsSync(join(destination, destPath))) continue;
    // The snapshot records what the scaffold delivered — the destination's
    // on-disk bytes, not the template source: personalized files (package.json,
    // AGENTS.md, pnpm-workspace.yaml) already diverge from the parent at init,
    // and those delivered hashes are the baseline the next upgrade compares
    // hand edits against (ADR 0034).
    const content = readFileSync(join(destination, destPath));
    fileHashes[destPath] = computeHash(content);
  }

  await writeSnapshot(destination, {
    files: fileHashes,
  });
}

export async function generateDatabaseMigrations(destination: string): Promise<void> {
  const drizzleConfigs = await glob("**/drizzle.config.ts", {
    cwd: destination,
    nodir: true,
    dot: false,
    absolute: false,
    ignore: ["**/node_modules/**"],
  });

  for (const configPath of drizzleConfigs) {
    const workspaceDir = dirname(configPath);
    const pkgPath = join(destination, workspaceDir, "package.json");
    if (!existsSync(pkgPath)) continue;

    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (!scripts?.["db:generate"]) continue;

    const cwd = join(destination, workspaceDir);
    await execCommand("pnpm", ["--dir", "api", "exec", "drizzle-kit", "generate"], cwd);
  }
}

const COMMAND_TIMEOUTS: Record<string, number> = {
  pnpm: 5 * 60_000,
  node_modules: 2 * 60_000,
  tar: 60_000,
};

export async function execCommand(
  command: string,
  args: string[],
  cwd?: string,
  options?: { stdio?: "pipe" | "inherit" },
): Promise<void> {
  const timeout = COMMAND_TIMEOUTS[command] ?? 2 * 60_000;
  await execa(command, args, { cwd, stdio: options?.stdio ?? "pipe", timeout });
}

export function extractSkillsBlock(content: string): string {
  const match = content.match(/<!-- intent-skills:start -->[\s\S]*?<!-- intent-skills:end -->/);
  return match ? match[0] : "";
}

function buildChildAgentsInstructions(opts: {
  overrides: OverrideSection[];
  plugins?: string[];
}): string {
  const has = (section: OverrideSection) => opts.overrides.includes(section);
  const parts: string[] = [];

  parts.push(`# Agent Instructions

This document provides operational guidance for AI agents working in this everything.dev project.

## Quick Reference

**Never use bun.** CI fails on any \`bun.lock\` artifact — bun re-migrates the workspace (framework ADR 0026, see https://github.com/NEARBuilders/everything-dev). Run package managers and executables as \`pnpm …\` / \`pnpm exec …\`.

**Start Development:**
\`\`\`bash
pnpm install
pnpm run dev
\`\`\`

**Check Status:**
\`\`\`bash
bos ps        # List running processes
bos status    # Project health check
bos info      # Show configuration
\`\`\`

**Deploy:**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/everything-dev-template?referralCode=MuB_vg&utm_medium=integration&utm_source=template&utm_campaign=generic)

The Railway template deploys the everything.dev Docker image. Set these variables:

| Variable | Description | Example |
|----------|-------------|---------|
| \`BOS_ACCOUNT\` | The NEAR account that owns this app's published configuration on-chain | \`myapp.near\` |
| \`BOS_GATEWAY\` | The core domain where this app is served | \`myapp.com\` |
| \`BETTER_AUTH_SECRET\` | Secret for session encryption — generate with \`openssl rand -base64 32\` | (random) |

**Self-deployed production:**

You don't need to wait for a PR to merge and run through CI/CD. Publish your own config on-chain under your own NEAR account and run your own host instance, inheriting the base platform via \`extends\`.

1. **Install near-cli-rs** (the \`bos\` CLI shells out to it for \`bos publish\` and \`bos login --key\`):
   \`\`\`bash
   curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/download/v0.23.5/near-cli-rs-installer.sh | sh
   \`\`\`
2. **Create a NEAR account** (testnet or mainnet). Named accounts can own subaccounts; implicit hex accounts cannot:
   \`\`\`bash
   near account create-account fund-my-account <your-account>.testnet use-faucet network-config testnet
   \`\`\`
3. **Generate a publish key** — a function-call key scoped to the FastKV registry contract:
   \`\`\`bash
   bos login --key
   \`\`\`
   The key is exported to the near-cli-rs keystore; set \`NEAR_PRIVATE_KEY\` in \`.env\` or CI secrets when running non-interactively.
4. **Update \`bos.app.ts\`** — set \`account\` to your NEAR account, add \`extends\` to inherit the base platform, keep \`domain\` as the gateway:
   \`\`\`ts
   { "extends": "bos://<parent-account>/<parent-gateway>", "account": "<your-account>.near", "domain": "<parent-gateway>" }
   \`\`\`
 5. **Publish and deploy:**
    \`\`\`bash
    bos deploy           # preflight → build → upload bundles → publish config to FastKV at bos://<your-account>/<gateway> → image/Railway when configured
    \`\`\`
6. **Deploy to Railway** (one-click template or \`railway up\`), set \`BOS_ACCOUNT\`, \`BOS_GATEWAY\` (same gateway as parent), and \`BETTER_AUTH_SECRET\`. Your Railway host fetches your config from FastKV and serves live.

\`BOS_GATEWAY\` is the **FastKV lookup key**, not the DNS domain your Railway instance serves on. By keeping the same gateway while using your own \`BOS_ACCOUNT\`, your config lives at a separate FastKV path that \`extends\` the base runtime — you inherit the full platform and override only what you change.

**Tenant creation** (for the admin wizard) is DAO-owned: connect a sputnik-dao account via the Trezu wallet in the admin wizard; the wizard publishes the tenant runtime config under \`bos://<dao-account>/<gateway>\`. No server-side subaccount keys are needed.`);

  const archLines = [
    "This is an everything.dev child project. Depending on your overrides, it may include:",
  ];
  if (has("ui"))
    archLines.push("- **UI** — React 19 + TanStack Router frontend, loaded via Module Federation");
  if (has("api")) archLines.push("- **API** — Hono.js + oRPC backend with Effect services");
  if (has("host"))
    archLines.push("- **Host** — Server-side runtime with Module Federation orchestration");
  if (has("plugins"))
    archLines.push("- **Plugins** — Self-contained business logic modules with oRPC contracts");
  archLines.push(
    "",
    "The parent runtime provides the shared framework; your project provides custom overrides.",
  );
  parts.push(`## Architecture\n\n${archLines.join("\n")}`);

  parts.push(`## Development Workflow

### Starting Development
1. \`pnpm install\`
2. \`pnpm run dev\`
3. \`bos dev\` creates \`.env\` on first run; local data is a persistent PGlite data dir (\`.bos/db\`), no docker involved`);

  parts.push(`### Debugging Issues

**API not responding:**
- Check \`bos ps\` to see if the API process is running
- Check \`.bos/logs/api.log\` for errors

**UI not loading:**
- Verify the dev server is running: \`bos ps\`
- Check browser console for Module Federation errors
- Clear browser cache and retry

**Type errors:**
- Run \`pnpm run typecheck\``);

  const changeLines: string[] = ["### Making Changes"];
  if (has("ui"))
    changeLines.push("- **UI Changes**: Edit `ui/src/` files → hot reload automatically");
  if (has("api"))
    changeLines.push("- **API Changes**: Edit `api/src/` files → hot reload automatically");
  if (has("host"))
    changeLines.push(
      "- **Host Changes**: Edit `host/src/` when changing runtime resolution, auth wiring, SSR, proxying, or plugin mounting",
    );
  changeLines.push(
    "- **New Components**: Create in `ui/src/components/ui/`, export from `ui/src/components/index.ts`",
  );
  changeLines.push(
    "- **New Routes**: Create file in `ui/src/routes/`, TanStack Router auto-generates tree",
  );
  parts.push(`## Code Changes\n\n${changeLines.join("\n")}`);

  parts.push(`### Style Requirements
- Use semantic Tailwind classes: \`bg-background\`, \`text-foreground\`, \`text-muted-foreground\`
- No hardcoded colors like \`bg-blue-600\`
- No code comments in implementation
- Component file naming: lowercase kebab-case (\`data-table.tsx\`, \`user-profile.tsx\`)
- Follow existing patterns in neighboring files

Review-time rules — the write-once goal, type-safety patterns, the workaround protocol, and the comment \`KEEP\`/\`TODO\` conventions — are in [\`docs/agents/coding-standards.md\`](docs/agents/coding-standards.md).`);

  parts.push(`### Framework-owned files and the upstream-change protocol (ADR 0032)

The files carrying the \`FRAMEWORK-OWNED\` header (build configs, db/lib plumbing, workflows) are reconciled from the parent template by \`bos upgrade\`: template wins on the next upgrade, local copies are backed up under \`.bos/sync-backup/\`, and **same-version upgrades never touch them** (only the framework version change reconciles them).

**Editing them is allowed.** When the work needs it, edit a framework-owned file, keep the build/typecheck/tests green — then **file an accompanying issue at https://github.com/NEARBuilders/everything-dev/issues** describing the change so it gets implemented in the framework and shipped in package versions. A local edit without an upstream issue is an undocumented fork that the next upgrade will quietly clobber.

When the need is a **bug**, a **missing capability**, or a **pattern improvement**, follow [\`docs/agents/change-placement.md\`](docs/agents/change-placement.md) — including its first rule: sync-owned files are a contribution channel, not a fence. A human-facing diagram tour of the whole runtime lives in [\`docs/agents/how-it-fits.md\`](docs/agents/how-it-fits.md); \`/teach\` builds lessons from it.`);

  if (has("api")) {
    parts.push(`### Adding API Endpoints
1. Define in \`api/src/contract.ts\` — the oRPC route definitions and Zod schemas
2. Implement in \`api/src/index.ts\` — the \`createRouter\` function
3. Use in UI via \`apiClient\` from \`useApiClient()\` in \`@/app\``);
  }

  if (has("plugins")) {
    parts.push(`### Plugin Architecture

Business logic is organized into independent plugins loaded via Module Federation:
- Each plugin has its own \`contract.ts\` — oRPC route definitions and Zod schemas
- Each plugin has its own \`index.ts\` — \`createPlugin\` with variables, secrets, context, router
- Each plugin has its own rspack config for independent deployment

The UI accesses plugin routes via namespaced clients: \`apiClient.<plugin>.<method>()\`.

### Plugin Client (pluginsClient)

The API plugin receives typed client factories for all other plugins via \`createPlugin.withPlugins<PluginsClient>()\`, enabling in-process composition without HTTP roundtrips.

### Generated Types

\`api/src/lib/plugins-types.gen.ts\`, \`api/src/lib/auth-types.gen.ts\`, \`ui/src/lib/api-types.gen.ts\`, and \`ui/src/lib/auth-types.gen.ts\` are generated by \`bos types gen\` from \`bos.app.ts\`. These files are gitignored and auto-regenerated on \`pnpm install\`, \`typecheck\`, \`bos dev\`, \`bos build\`, and bos plugin management commands.

If you hand-edit \`bos.app.ts\`, run \`bos types gen\` or restart \`bos dev\` to regenerate.`);
  }

  const testCommands: string[] = [];
  if (has("api") || has("host") || has("ui")) {
    testCommands.push("pnpm run test    # Run all tests");
    testCommands.push("pnpm run typecheck   # Type check all packages");
    testCommands.push("pnpm run lint        # Run linting");
  }
  if (testCommands.length > 0) {
    parts.push(`## Testing & Quality

**Before committing:**
\`\`\`bash
${testCommands.join("\n")}
\`\`\`

When to write a test, which layer, what the parent framework covers vs what
this repo must cover: [\`docs/agents/testing.md\`](docs/agents/testing.md).`);
  }

  parts.push(`## Common Patterns

### Authentication Check

Routes requiring auth use \`_authenticated.tsx\` layout:
\`\`\`typescript
export const Route = createFileRoute('/_layout/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session?.user) {
      throw redirect({ to: '/login', search: { redirect: location.pathname } });
    }
  },
});
\`\`\``);

  if (has("ui")) {
    parts.push(`### API Client Usage
\`\`\`typescript
import { useApiClient } from "@/app";

function MyComponent() {
  const apiClient = useApiClient();
  const { data } = await apiClient.ping();
}
\`\`\``);
  }

  parts.push(`## Workflow Skills

This repo ships agent workflow skills in \`.agents/skills/\` — the ordered development flow (grill → spec → tickets → implement/tdd → code-review). Start \`/everything-dev-app\` to orient and pick the right next step; \`/ask-matt\` is the router if unsure.

- \`/grill-with-docs\` — sharpen an idea by interview, leaving a paper trail in \`GLOSSARY.md\` and ADRs
- \`/to-spec\` / \`/to-tickets\` — turn a plan into a spec, then tracer-bullet tickets under \`.scratch/<feature>/issues/\`
- \`/implement\` + \`/tdd\` — build a ticket test-first at pre-agreed seams
- \`/code-review\` — two-axis review (Standards + Spec) of the diff since a fixed point
- \`/diagnosing-bugs\` — diagnosis loop for hard bugs and performance regressions

Run \`/setup-matt-pocock-skills\` once before first use. Tracker and triage conventions live in \`docs/agents/\`.`);

  parts.push(`## Agent Communication Surface

The host exposes several surfaces for programmatic agent access:

| Surface | Endpoint | Auth | Use |
|---------|----------|------|-----|
| MCP | \`POST /api/mcp\` | \`x-api-key\` header or session cookie | MCP clients — auto-generated tools from OpenAPI spec, stateless Streamable HTTP transport |
| REST/OpenAPI | \`GET/POST/... /api/{path}\` | \`x-api-key\` header or session cookie | Standard REST; Scalar docs at \`GET /api\`, spec at \`GET /api/spec.json\` |
| oRPC RPC | \`POST /api/rpc/{procedure}\` | \`x-api-key\` header or session cookie | Typed JSON-RPC for all API procedures |
| Plugin RPC | \`POST /api/rpc/{plugin}/{procedure}\` | \`x-api-key\` header or session cookie | Per-plugin RPC (e.g. \`/api/rpc/auth/getSession\`) |
| MCP discovery | \`GET /.well-known/mcp.json\` | None | JSON descriptor with server name, endpoint, and auth scheme |

### Authentication for agents

Every surface requires a session or API key — anonymous requests get \`401\` (including MCP \`tools/list\`).

1. Sign in with your NEAR wallet (SIWN) at the website — or run \`bos login\` from a machine with a browser.
2. Navigate to **Settings → API Keys** at \`/settings/api-keys\`.
3. Create a new key — the full secret (\`api_...\`) is shown once. Copy it immediately.
4. Pass it on every request: \`x-api-key: api_your_key_here\`

### Architecture note: remotes are code bundles

Remotes in \`bos.app.ts\` are **not hosted APIs** — they are code bundles loaded via Module Federation at runtime. The UI, API, auth, and plugins all run in the same host process. There is no remote server to call; everything is loaded in-process through Module Federation and \`every-plugin\`.`);

  parts.push(`## Troubleshooting

**Process won't start:**
\`\`\`bash
bos kill        # Kill all tracked processes
pnpm install    # Ensure dependencies
pnpm run dev    # Restart
\`\`\`

**Docker commands hang instead of failing:** the daemon is down (it hangs, not fails — a slow API call masks it). Start Docker Desktop and retry; probe with a short timeout, don't extend the timeout hoping it completes.

**Module Federation errors:**
- Check \`bos.app.ts\` URLs are accessible
- Verify shared dependency versions match in package.json
- Clear browser cache

**Database issues:**
\`\`\`bash
pnpm run db:push   # Push schema changes
pnpm run db:studio # Open Drizzle Studio
\`\`\`

## Environment

**Required files:**
- \`.env\` — Secrets (see \`.env.example\`)
- \`bos.app.ts\` — Runtime configuration (committed)`);

  return `${parts.join("\n\n")}\n`;
}

export function buildChildAgentsMd(
  skillsBlock: string,
  opts: {
    overrides: OverrideSection[];
    plugins?: string[];
  },
): string {
  return `${skillsBlock}\n\n${buildChildAgentsInstructions(opts)}`;
}

export async function personalizeAgentsMd(
  destination: string,
  opts: {
    overrides: OverrideSection[];
    plugins?: string[];
  },
): Promise<void> {
  const agentsMdPath = join(destination, "AGENTS.md");
  if (!existsSync(agentsMdPath)) return;

  const content = readFileSync(agentsMdPath, "utf-8");
  const skillsBlock = extractSkillsBlock(content);
  if (!skillsBlock) return;

  const childContent = buildChildAgentsMd(skillsBlock, opts);
  writeFileSync(agentsMdPath, childContent);
}

function generateGitignore(): string {
  return `node_modules/
dist/
.env
.bos/
*.gen.ts
*.gen.tsx
`;
}

const WORKFLOW_SKILLS_MARKER = "everything-dev-app";
const WORKFLOW_SKILLS_NOTE = `

## Workflow skills

This repo ships agent workflow skills in \`.agents/skills/\` — the ordered development flow (grill → spec → tickets → implement/tdd → code-review). Start with \`/everything-dev-app\` to orient and pick the right next step. See \`AGENTS.md\` → Workflow Skills.
`;

export function buildChildLlmsTxt(title: string): string {
  return `# ${title}

> Application running on the everything.dev runtime.

## Skills

- [Skill](/skill.md): Agent-ready prompt for talking to, running, editing, and publishing this runtime.
- Workflow skills (in the repo): \`.agents/skills/\` — start with \`everything-dev-app\` for the ordered development flow.

## API

- [OpenAPI docs](/api): Interactive API reference (Scalar)
- [OpenAPI spec](/api/spec.json): Machine-readable OpenAPI JSON
- [oRPC RPC](/api/rpc): Typed JSON-RPC endpoint for all API procedures
- [Plugin RPC](/api/rpc/auth): Auth plugin RPC (session, NEAR SIWN, relay, API keys, organizations)

## MCP

- [MCP server](/api/mcp): Model Context Protocol server (Streamable HTTP, stateless). Auto-generates tools from the API's OpenAPI spec.
- [MCP discovery](/.well-known/mcp.json): JSON descriptor with server name, endpoint URL, and auth scheme.

## Auth

Authenticate to the API using an API key (every surface — REST, RPC, MCP — requires a session or key; anonymous requests get \`401\`):

1. Sign in with your NEAR wallet (SIWN) at the website — or run \`bos login\` from a machine with a browser.
2. Go to **Settings → API Keys** at \`/settings/api-keys\`.
3. Create a key — the full secret (\`api_...\`) is shown once.
4. Pass it on every request: \`x-api-key: api_your_key_here\`

The \`x-api-key\` header works for \`/api/*\` (REST), \`/api/rpc/*\` (oRPC), and \`/api/mcp\` (MCP).

## Source

- [Repository](https://github.com/NEARBuilders/everything-dev): Clone and read \`AGENTS.md\` for full development instructions, TanStack Intent skills, and workflow guidance.
`;
}

export function buildChildSkillMd(title: string, repository: string): string {
  const repoLink = repository
    ? `- [Repository](${repository}): Clone and read \`AGENTS.md\` for full development instructions.`
    : `- Clone the repository and read \`AGENTS.md\` for full development instructions.`;

  return `# ${title} skill

Use this when you want an agent to run, edit, and publish **${title}** — an everything.dev app composed at runtime from \`bos.app.ts\`.

There are two ways to work with this app:

1. **Talk to the app** — use the API via MCP or REST to read/write data without cloning anything.
2. **Clone and modify** — clone the repository, run locally, edit code, and publish.

## Mode 1: Talk to the app

### MCP endpoint

\`\`\`
POST /api/mcp
\`\`\`

Transport: Streamable HTTP (stateless). Connect your MCP client to \`{origin}/api/mcp\` to discover all available tools automatically.

### Authentication

Every API surface (REST, RPC, MCP) requires a session or an API key — anonymous
requests get \`401\`. Use an **API key**:

1. Sign in with your NEAR wallet at the website (SIWN).
2. Navigate to **Settings → API Keys** at \`/settings/api-keys\`.
3. Create a key — the full secret (\`api_...\`) is shown once.
4. Pass it on every request: \`x-api-key: api_your_key_here\`

Or from a machine with a browser: \`bos login\` — one approval, and the CLI
persists an API key in \`.bos/session.json\` for headless use.

### Deep dive

The full API/auth skill is served by this app at
\`{origin}/skills/everything-dev/talk-to-the-app/SKILL.md\` (MCP, REST, RPC,
API keys, troubleshooting refusals).

### REST / OpenAPI

- **API docs**: \`GET /api\`
- **OpenAPI spec**: \`GET /api/spec.json\`
- **oRPC RPC**: \`POST /api/rpc/{procedure}\`
- **MCP discovery**: \`GET /.well-known/mcp.json\`

## Mode 2: Clone and modify

### TanStack Intent

- Registry entry: \`https://tanstack.com/intent/registry/everything-dev\`
- Load with TanStack Intent: \`npx @tanstack/intent@latest load everything-dev\`

### Read AGENTS.md first

After cloning, read **\`AGENTS.md\`** at the repo root. It contains operational guidance, TanStack Intent skills, and workflow instructions.

### Workflow skills

The repo ships agent workflow skills in \`.agents/skills/\` — start with \`everything-dev-app\` for the ordered development flow (grill → spec → tickets → implement/tdd → code-review).

### Architecture note

Remotes in \`bos.app.ts\` are **not hosted APIs** — they are code bundles loaded via Module Federation at runtime. Everything runs in the same host process.

### Run locally

\`\`\`bash
pnpm install
bos dev
\`\`\`

### Publish

\`\`\`bash
bos deploy
\`\`\`

## Source

${repoLink}
`;
}
