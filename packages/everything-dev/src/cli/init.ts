import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { execa } from "execa";
import { glob } from "glob";
import type { OverrideSection } from "../contract";
import { fetchBosConfigFromFastKv } from "../fastkv";
import {
  loadManifestNormalizationSpec,
  normalizePackageManifestsInTree,
} from "../internal/manifest-normalizer";
import { resolveExtendsRef } from "../merge";
import type { BosConfig, BosConfigInput } from "../types";
import { saveBosConfig } from "../utils/save-config";
import { writeSnapshot } from "./snapshot";

const require = createRequire(import.meta.url);

export const INIT_ROOT_PATTERNS = [
  "bos.config.json",
  "package.json",
  ".env.example",
  ".gitignore",
  "biome.json",
  "bunfig.toml",
  "Dockerfile",
  "railway.json",
  "railway.toml",
  "AGENTS.md",
  ".changeset/config.json",
  ".changeset/README.md",
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

interface SourceResult {
  sourceDir: string;
  parentConfig: BosConfig;
  cleanup: () => Promise<void>;
}

export interface CatalogChainSource {
  catalog: Record<string, string>;
  repository?: string;
  extendsChain: string[];
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

function readWorkspaceCatalog(sourceDir: string): Record<string, string> {
  const pkgPath = join(sourceDir, "package.json");
  if (!existsSync(pkgPath)) {
    return {};
  }

  const pkg = readJsonFile<{ workspaces?: { catalog?: Record<string, string> } }>(pkgPath);
  return { ...(pkg.workspaces?.catalog ?? {}) };
}

export async function resolveCatalogChainSource(opts: {
  extendsAccount: string;
  extendsGateway: string;
  sourceDir?: string;
}): Promise<CatalogChainSource> {
  const catalogs: Record<string, string>[] = [];
  const cleanups: Array<() => Promise<void>> = [];
  const extendsChain: string[] = [];
  const visited = new Set<string>();
  let repository: string | undefined;
  let currentRef = `bos://${opts.extendsAccount}/${opts.extendsGateway}`;
  let sourceDir = opts.sourceDir ? resolve(opts.sourceDir) : undefined;
  let configPath = sourceDir ? join(sourceDir, "bos.config.json") : undefined;

  try {
    while (true) {
      if (visited.has(currentRef)) {
        throw new Error(`Circular extends detected while resolving catalog source: ${currentRef}`);
      }

      visited.add(currentRef);
      extendsChain.push(currentRef);

      let config: Record<string, unknown>;
      let currentSourceDir = sourceDir;
      let cleanup: () => Promise<void> = async () => {};

      if (configPath) {
        config = readJsonFile<Record<string, unknown>>(configPath);
        currentSourceDir = dirname(configPath);
      } else {
        const parsed = parseBosRef(currentRef);
        if (!parsed) {
          break;
        }
        const sourceResult = await resolveSourceDir({
          extendsAccount: parsed.account,
          extendsGateway: parsed.gateway,
        });
        config = sourceResult.parentConfig as Record<string, unknown>;
        currentSourceDir = sourceResult.sourceDir || undefined;
        cleanup = sourceResult.cleanup;
      }

      cleanups.push(cleanup);
      catalogs.push(currentSourceDir ? readWorkspaceCatalog(currentSourceDir) : {});

      if (typeof config.repository === "string") {
        repository = config.repository;
      }

      const nextExtendsRef = getExtendsRef(config);
      if (!nextExtendsRef) {
        break;
      }

      if (nextExtendsRef.startsWith("bos://")) {
        currentRef = nextExtendsRef;
        sourceDir = undefined;
        configPath = undefined;
        continue;
      }

      if (!currentSourceDir) {
        break;
      }

      const nextConfigPath = resolve(currentSourceDir, nextExtendsRef);
      if (!existsSync(nextConfigPath)) {
        break;
      }

      currentRef = nextConfigPath;
      sourceDir = dirname(nextConfigPath);
      configPath = nextConfigPath;
    }
  } finally {
    for (const cleanup of cleanups.reverse()) {
      await cleanup();
    }
  }

  return {
    catalog: Object.assign({}, ...catalogs.reverse()),
    repository,
    extendsChain,
  };
}

export async function resolveSourceDir(opts: {
  extendsAccount: string;
  extendsGateway: string;
  source?: string;
}): Promise<SourceResult> {
  if (opts.source) {
    const sourceDir = resolve(opts.source);
    if (!existsSync(join(sourceDir, "bos.config.json"))) {
      throw new Error(`No bos.config.json found in source directory: ${sourceDir}`);
    }
    const parentConfig = JSON.parse(
      readFileSync(join(sourceDir, "bos.config.json"), "utf-8"),
    ) as BosConfig;
    return { sourceDir, parentConfig, cleanup: async () => {} };
  }

  const parentConfig = await fetchParentConfig(opts.extendsAccount, opts.extendsGateway);

  if (parentConfig.repository) {
    const { dir: sourceDir, cleanup } = await downloadTarball(parentConfig.repository);
    return { sourceDir, parentConfig, cleanup };
  }

  const chainResult = await resolveRepositoryViaExtendsChain(
    opts.extendsAccount,
    opts.extendsGateway,
  );
  if (chainResult?.repository) {
    const { dir: sourceDir, cleanup } = await downloadTarball(chainResult.repository);
    return { sourceDir, parentConfig: chainResult.config, cleanup };
  }

  return {
    sourceDir: "",
    parentConfig,
    cleanup: async () => {},
  };
}

export function buildInitPatterns(overrides: OverrideSection[], plugins?: string[]): string[] {
  const has = (section: OverrideSection) => overrides.includes(section);
  const patterns: string[] = [...INIT_ROOT_PATTERNS];

  if (has("ui")) patterns.push("ui/**");
  if (has("api")) patterns.push("api/**");
  if (has("host")) patterns.push("host/**");
  if (has("plugins")) {
    for (const plugin of plugins ?? []) {
      patterns.push(`plugins/${plugin}/**`);
    }
  }

  return patterns;
}

export function sourcePathToDestinationPath(filePath: string): string {
  return filePath.startsWith(".github/templates/")
    ? filePath.replace(/^\.github\/templates\//, ".github/")
    : filePath;
}

export async function fetchParentConfig(
  extendsAccount: string,
  extendsGateway: string,
): Promise<BosConfig> {
  const bosUrl = `bos://${extendsAccount}/${extendsGateway}`;
  return fetchBosConfigFromFastKv<BosConfig>(bosUrl);
}

export async function resolveRepositoryViaExtendsChain(
  extendsAccount: string,
  extendsGateway: string,
  visited = new Set<string>(),
): Promise<{ repository: string; config: BosConfig } | null> {
  const key = `bos://${extendsAccount}/${extendsGateway}`;
  if (visited.has(key)) return null;
  visited.add(key);

  try {
    const config = await fetchParentConfig(extendsAccount, extendsGateway);
    if (config.repository) {
      return { repository: config.repository, config };
    }

    const extendsRef = getExtendsRef(config as Record<string, unknown>);
    if (extendsRef) {
      const normalized = extendsRef.startsWith("bos://") ? extendsRef : `bos://${extendsRef}`;
      const parsed = parseBosRef(normalized);
      if (parsed) {
        const result = await resolveRepositoryViaExtendsChain(
          parsed.account,
          parsed.gateway,
          visited,
        );
        if (result) return result;
      }
    }

    return null;
  } catch {
    return null;
  }
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

export async function downloadTarball(
  repoUrl: string,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    throw new Error(`Cannot parse repository URL: ${repoUrl}`);
  }

  const { owner, repo } = parsed;
  let response: Response | null = null;

  for (const branch of ["main", "master"]) {
    const candidate = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/tarball/${branch}`,
      {
        headers: { "User-Agent": "everything-dev" },
        redirect: "follow",
      },
    );
    if (candidate.ok) {
      response = candidate;
      break;
    }
    if (candidate.status !== 404) {
      throw new Error(
        `GitHub tarball download failed: ${candidate.status} ${candidate.statusText}`,
      );
    }
  }

  if (!response) {
    throw new Error(`GitHub tarball download failed for ${repoUrl}: tried main and master`);
  }

  if (!response.body) {
    throw new Error("GitHub tarball download returned empty body");
  }

  const tmpDir = mkTmpDir("bos-init-tarball-");
  const tarballPath = join(tmpDir, "source.tar.gz");

  const fileStream = createWriteStream(tarballPath);
  const reader = response.body as unknown as NodeJS.ReadableStream;
  await pipeline(reader, fileStream);

  const extractDir = mkTmpDir("bos-init-extract-");
  try {
    const tar = require("tar") as {
      extract: (opts: { cwd: string; file: string; strip: number }) => Promise<void>;
    };
    await tar.extract({ cwd: extractDir, file: tarballPath, strip: 1 });
  } catch {
    await execCommand("tar", ["-xzf", tarballPath, "--strip-components=1", "-C", extractDir]);
  }

  rmSync(tmpDir, { recursive: true, force: true });

  return {
    dir: extractDir,
    cleanup: async () => {
      rmSync(extractDir, { recursive: true, force: true });
    },
  };
}

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

export async function copyFilteredFiles(
  sourceDir: string,
  destination: string,
  patterns: string[],
  _options: {
    overrides: OverrideSection[];
    plugins?: string[];
  },
): Promise<number> {
  if (patterns.length === 0) {
    return 0;
  }

  const allFiles = new Set<string>();
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: sourceDir,
      nodir: true,
      dot: true,
      absolute: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.bos/**"],
    });
    for (const match of matches) {
      allFiles.add(match);
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
}

function buildRootTypecheckScript(sections: {
  ui: boolean;
  api: boolean;
  host: boolean;
  plugins: boolean;
}): string {
  const commands = ["bun run types:gen"];

  if (sections.ui) {
    commands.push("if [ -d ui ]; then bun run --cwd ui typecheck; fi");
  }
  if (sections.api) {
    commands.push("if [ -d api ]; then bun run --cwd api typecheck; fi");
  }
  if (sections.host) {
    commands.push("if [ -d host ]; then bun run --cwd host typecheck; fi");
  }
  if (sections.plugins) {
    commands.push(
      'if [ -d plugins ]; then for dir in plugins/*; do if [ -f "$dir/package.json" ]; then bun run --cwd "$dir" typecheck; fi; done; fi',
    );
  }

  return commands.join(" && ");
}

export function buildChildRootScripts(sections: {
  ui: boolean;
  api: boolean;
  host: boolean;
  plugins: boolean;
}): Record<string, string> {
  const scripts: Record<string, string> = {
    dev: "node_modules/.bin/bos dev --host remote",
    "dev:proxy": "node_modules/.bin/bos dev --proxy",
    build: "node_modules/.bin/bos build",
    deploy: "node_modules/.bin/bos build --deploy",
    publish: "node_modules/.bin/bos publish",
    start: "node_modules/.bin/bos start",
    typecheck: buildRootTypecheckScript(sections),
    lint: "biome check .",
    "lint:fix": "biome check --write .",
    format: "biome format --write .",
    "format:check": "biome format .",
    changeset: "changeset",
    version: "changeset version",
    release: "echo 'Packages versioned - app release handled by workflow'",
    postinstall: "node_modules/.bin/bos types gen || true",
    "types:gen": "node_modules/.bin/bos types gen",
    bos: "node_modules/.bin/bos",
  };

  if (sections.api) {
    scripts["db:push"] = "bun run --cwd api drizzle-kit push";
    scripts["db:studio"] = "bun run --cwd api drizzle-kit studio";
    scripts["db:generate"] = "bun run --cwd api drizzle-kit generate";
    scripts["db:migrate"] = "bun run --cwd api drizzle-kit migrate";
    scripts["test:api"] = "cd api && bun run test tests/integration/ tests/unit/";
    scripts["test:integration"] = "cd api && bun run test tests/integration/";
  }

  if (sections.host) {
    scripts["test:e2e"] = "bun run --cwd host test:e2e";
  }

  if (sections.api && sections.host) {
    scripts.test = "bun run test:api && bun run test:e2e";
  } else if (sections.api) {
    scripts.test = "bun run test:api";
  } else if (sections.host) {
    scripts.test = "bun run test:e2e";
  }

  if (sections.api || sections.host) {
    scripts["dev:postgres"] = "docker compose up -d --wait && bun run dev";
    scripts["dev:postgres:down"] = "docker compose down";
    scripts["dev:postgres:reset"] = "docker compose down -v && docker compose up -d --wait";
  }

  if (sections.ui) {
    scripts["dev:ui"] = "node_modules/.bin/bos dev --ui local --api remote";
  }
  if (sections.api) {
    scripts["dev:api"] = "node_modules/.bin/bos dev --ui remote --api local";
  }

  return scripts;
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
  },
): Promise<void> {
  const has = (section: OverrideSection) => opts.overrides.includes(section);
  const existingApp =
    opts.mode === "sync" && opts.existingConfig?.app && typeof opts.existingConfig.app === "object"
      ? (opts.existingConfig.app as Record<string, unknown>)
      : undefined;
  const preservedAuth = existingApp?.auth;

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
          ].includes(key),
      )
      .map(([key]) => key),
  );

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
          delete config.plugins;
        }
      }
    } else {
      delete config.plugins;
    }

    if (opts.mode === "sync" && opts.existingConfig) {
      const managedRootKeys = new Set(["extends", "account", "domain", "app", "plugins", "shared"]);
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
    delete pkg.module;
    delete pkg.peerDependencies;

    if (pkg.workspaces && typeof pkg.workspaces === "object") {
      const ws = pkg.workspaces as { packages?: string[] };
      if (Array.isArray(ws.packages)) {
        ws.packages = ws.packages.filter((p: string) => {
          if (p.startsWith("packages/")) return false;
          if (p === "ui") return has("ui");
          if (p === "api") return has("api");
          if (p === "host") return has("host");
          if (p.startsWith("plugins/")) return false;
          return true;
        });

        if (has("plugins")) {
          if (!ws.packages.includes("plugins/*")) {
            ws.packages.push("plugins/*");
          }
        }
      }
    }

    if (!pkg.scripts || typeof pkg.scripts !== "object") {
      pkg.scripts = {};
    }
    const scripts = pkg.scripts as Record<string, string>;
    for (const [key, value] of Object.entries(childScripts)) {
      scripts[key] = value;
    }
    for (const obsoleteScript of [
      "init",
      "sync-catalog",
      "db:push",
      "db:studio",
      "db:generate",
      "db:migrate",
      "test",
      "test:api",
      "test:integration",
      "test:e2e",
      "dev:postgres",
      "dev:postgres:down",
      "dev:postgres:reset",
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

    if (!pkg.workspaces || typeof pkg.workspaces !== "object") {
      pkg.workspaces = { packages: [], catalog: {} };
    }
    const workspaces = pkg.workspaces as { packages?: string[]; catalog?: Record<string, string> };
    if (!workspaces.catalog || typeof workspaces.catalog !== "object") {
      workspaces.catalog = {};
    }

    if (!pkg.dependencies) pkg.dependencies = {};
    const deps = pkg.dependencies as Record<string, string>;
    const spec = opts.workspaceOpts?.sourceDir
      ? loadManifestNormalizationSpec(opts.workspaceOpts.sourceDir)
      : null;
    if (spec) {
      workspaces.catalog["everything-dev"] = spec.rootCatalog["everything-dev"];
      workspaces.catalog["every-plugin"] = spec.rootCatalog["every-plugin"];
    }
    const frameworkCatalog = (
      await resolveCatalogChainSource({
        extendsAccount: opts.extendsAccount,
        extendsGateway: opts.extendsGateway,
        sourceDir: opts.workspaceOpts?.sourceDir,
      })
    ).catalog;
    for (const [name, version] of Object.entries(frameworkCatalog)) {
      workspaces.catalog[name] = version;
    }
    if (!deps["everything-dev"]) deps["everything-dev"] = "catalog:";
    if (!deps["every-plugin"]) deps["every-plugin"] = "catalog:";

    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
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
  }

  if (has("api")) {
    const pluginsClientGenPath = join(destination, "api", "src", "lib", "plugins-types.gen.ts");
    if (!existsSync(pluginsClientGenPath)) {
      mkdirSync(dirname(pluginsClientGenPath), { recursive: true });
      writeFileSync(
        pluginsClientGenPath,
        `import type { ContractRouterClient, AnyContractRouter } from "@orpc/contract";\ntype ClientFactory<C extends AnyContractRouter> = (context?: Record<string, unknown>) => ContractRouterClient<C>;\nexport type PluginsClient = Record<string, never>;\n`,
      );
    }
  }

  const authTypesContent = generateAuthTypesTemplate();
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
      writeFileSync(authTypesGenPath, authTypesContent);
    }
  }

  if (has("plugins")) {
    for (const plugin of opts.plugins ?? []) {
      const pluginSrcDir = join(destination, "plugins", plugin, "src");
      const pluginIndexPath = join(pluginSrcDir, "index.ts");
      const pluginClientGenPath = join(pluginSrcDir, "plugins-client.gen.ts");
      if (!existsSync(pluginIndexPath) || existsSync(pluginClientGenPath)) {
        continue;
      }
      const pluginIndex = readFileSync(pluginIndexPath, "utf-8");
      if (!pluginIndex.includes("./plugins-client.gen")) {
        continue;
      }
      writeFileSync(pluginClientGenPath, "export type PluginsClient = Record<string, never>;\n");
    }
  }
}

function generateAuthTypesTemplate(): string {
  return `import type { Auth } from "better-auth";
export type { Auth } from "better-auth";
export type AuthSessionUser = NonNullable<Auth["$Infer"]["Session"]["user"]> & {
  role?: string | null;
  isAnonymous?: boolean | null;
  walletAddress?: string | null;
  banned?: boolean | null;
};
export type AuthSessionData = NonNullable<Auth["$Infer"]["Session"]["session"]> & {
  activeOrganizationId?: string | null;
};
export type AuthSession = {
  user: AuthSessionUser | null;
  session: AuthSessionData | null;
};
export interface AuthOrganizationContext {
  activeOrganizationId: string | null;
  organization: { id: string; name: string; slug: string; logo?: string | null; metadata?: Record<string, unknown> } | null;
  member: { id: string; role: string } | null;
  isPersonal: boolean;
  hasOrganization: boolean;
}
export interface AuthRequestContext {
  user: AuthSessionUser | null;
  userId: string | null;
  isAuthenticated: boolean;
  authMethod: "session" | "apiKey" | "anonymous" | "none";
  near: {
    primaryAccountId: string | null;
    linkedAccounts: Array<{ accountId: string; network: string; publicKey: string; isPrimary: boolean }>;
    hasNearAccount: boolean;
  };
  organization: AuthOrganizationContext;
  organizations?: Array<{ id: string; role: string; name?: string; slug?: string }>;
}
export type AuthActiveMember = { id: string | null; role: string | null; organizationId: string | null };
export type AuthOrganization = NonNullable<AuthOrganizationContext["organization"]>;
export type AuthOrganizationMember = NonNullable<AuthOrganizationContext["member"]>;
export type AuthOrganizationSummary = NonNullable<AuthRequestContext["organizations"]>[number];
export type AuthBaseSession = Auth["$Infer"]["Session"];
export type createAuthInstance = never;
export interface AuthServices {
  auth: Auth;
  db: unknown;
  driver: { close(): Promise<void> };
  handler: (req: Request) => Promise<Response>;
}
`;
}

export async function runBunInstall(
  destination: string,
  spinner?: { message: (msg: string) => void },
): Promise<void> {
  await runWithProgress(
    "bun",
    ["install", "--ignore-scripts"],
    destination,
    spinner,
    "Installing dependencies",
  );
}

export async function runBunInstallForUpgrade(
  destination: string,
  spinner?: { message: (msg: string) => void },
): Promise<void> {
  await runWithProgress(
    "bun",
    ["install", "--force"],
    destination,
    spinner,
    "Installing dependencies",
  );
}

export async function runTypesGen(
  destination: string,
  spinner?: { message: (msg: string) => void },
): Promise<void> {
  const localBosBin = join(destination, "node_modules", ".bin", "bos");
  if (existsSync(localBosBin)) {
    await runWithProgress(
      "node_modules/.bin/bos",
      ["types", "gen"],
      destination,
      spinner,
      "Generating types",
    );
    return;
  }

  throw new Error("Unable to locate bos CLI for types generation");
}

export async function runDockerComposeUp(destination: string): Promise<void> {
  await execCommand("docker", ["compose", "up", "-d", "--wait"], destination, { stdio: "inherit" });
}

async function runWithProgress(
  command: string,
  args: string[],
  cwd: string,
  spinner: { message: (msg: string) => void } | undefined,
  label: string,
): Promise<void> {
  const timeout = COMMAND_TIMEOUTS[command] ?? 2 * 60_000;
  const child = execa(command, args, { cwd, stdio: "inherit", timeout });

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

export function stripOrphanedWorkspacesFromLockfile(
  lockfilePath: string,
  allowedWorkspaces: string[],
): void {
  if (!existsSync(lockfilePath)) return;

  const content = readFileSync(lockfilePath, "utf-8");
  let lockfile: Record<string, unknown>;
  try {
    lockfile = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return;
  }

  const workspaces = lockfile.workspaces;
  if (!workspaces || typeof workspaces !== "object") return;

  const workspaceMap = workspaces as Record<string, unknown>;
  const allowed = new Set(["", ...allowedWorkspaces]);

  const keys = Object.keys(workspaceMap);
  let changed = false;
  for (const key of keys) {
    if (allowed.has(key)) continue;
    if (
      allowedWorkspaces.some(
        (pattern) => pattern.endsWith("/*") && key.startsWith(pattern.slice(0, -1)),
      )
    )
      continue;
    delete workspaceMap[key];
    changed = true;
  }

  if (changed) {
    writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);
  }
}

export function removeInitLockfile(lockfilePath: string): void {
  if (!existsSync(lockfilePath)) return;
  rmSync(lockfilePath, { force: true });
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
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
  }

  await saveBosConfig(destination, config);

  const workspacePackages: string[] = [];
  for (const section of opts.overrides) {
    workspacePackages.push(...OVERRIDE_WORKSPACE_MAP[section]);
  }
  if (has("plugins")) {
    workspacePackages.push("plugins/*");
  }

  const catalog = (
    await resolveCatalogChainSource({
      extendsAccount: opts.extendsAccount,
      extendsGateway: opts.extendsGateway,
    })
  ).catalog;

  const pkg: Record<string, unknown> = {
    name: "monorepo",
    private: true,
    type: "module",
    scripts: buildChildRootScripts({
      ui: has("ui"),
      api: has("api"),
      host: has("host"),
      plugins: has("plugins"),
    }),
    dependencies: {
      "everything-dev": "catalog:",
      "every-plugin": "catalog:",
    },
    devDependencies: {},
    workspaces: {
      packages: workspacePackages,
      catalog,
    },
  };
  writeFileSync(join(destination, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

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
  extendsAccount: string,
  extendsGateway: string,
  sourceDir: string,
  patterns: string[],
  _options: {
    overrides: OverrideSection[];
    plugins?: string[];
  },
): Promise<void> {
  const allFiles = new Set<string>();
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: sourceDir,
      nodir: true,
      dot: true,
      absolute: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.bos/**"],
    });
    for (const match of matches) {
      allFiles.add(match);
    }
  }

  const fileHashes: Record<string, string> = {};
  for (const filePath of allFiles) {
    const src = join(sourceDir, filePath);
    const stat = lstatSync(src);
    if (!stat.isFile()) continue;
    const content = readFileSync(src);
    const destPath = sourcePathToDestinationPath(filePath);
    fileHashes[destPath] = computeHash(content);
  }

  await writeSnapshot(destination, {
    parentRef: `bos://${extendsAccount}/${extendsGateway}`,
    files: fileHashes,
  });
}

function computeHash(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex").substring(0, 16);
}

function mkTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
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
    await execCommand("bun", ["run", "db:generate"], cwd);
  }
}

const COMMAND_TIMEOUTS: Record<string, number> = {
  bun: 5 * 60_000,
  docker: 5 * 60_000,
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

function generateGitignore(): string {
  return `node_modules/
dist/
.env
.bos/
*.gen.ts
*.gen.tsx
`;
}
