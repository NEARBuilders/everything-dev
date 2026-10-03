import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readWorkspaceCatalog, resolveSourceDir } from "../cli/init";
import { parseBosRef } from "../cli/utils/helpers";
import {
  BosConfigSchema,
  type BosEnv,
  buildRuntimeConfig,
  buildRuntimePluginsForConfig,
  CircularExtendsError,
  ConfigExtendsError,
  ConfigLoadError,
  ConfigNotfoundError,
  DEV_OVERLAY_FILENAME,
  defaultConfigEnv,
  findConfigPath,
  getConfigBaseDir,
  isAppDescriptorPath,
  loadAppDescriptorConfig,
  parseAppDescriptorModule,
  parseDevOverlayModule,
  parseExtendsTarget,
  resolveConfigComposableEntries,
  runWithConfigWarningSink,
} from "../config";
import { applyDevOverlay } from "../descriptor/resolve";
import { fetchBosConfigFromFastKv } from "../fastkv";
import { mergeBosConfigWithExtends, resolveExtendsRef } from "../merge";
import type {
  BosConfig,
  BosConfigInput,
  ExtendsConfig,
  RuntimeConfig,
  RuntimePluginConfig,
} from "../types";

export interface ResolutionRequest {
  cwd?: string;
  path?: string;
  bosUrl?: string;
  account?: string;
  gateway?: string;
  registry?: string;
  sourceDir?: string;
  env?: BosEnv;
  remotePlugins?: string[];
  collectCatalogs?: boolean;
}

export interface ResolutionIo {
  fetchBosConfig?(bosUrl: string, registry?: string): Promise<unknown>;
  readFileOrNull?(path: string): Promise<string | null>;
  importModule?(path: string): Promise<Record<string, unknown>>;
}

export interface RuntimeSources {
  uiSource?: "local" | "remote";
  apiSource?: "local" | "remote";
  authSource?: "local" | "remote";
  hostSource?: "local" | "remote";
  env?: "development" | "production";
  plugins?: Record<string, unknown>;
}

export interface WalkLink {
  ref: string;
  config: BosConfigInput;
  baseDir: string;
  sourceDir?: string;
  isLeaf: boolean;
}

interface ResolvedIo {
  fetchBosConfig: (bosUrl: string, registry?: string) => Promise<unknown>;
  readFileOrNull: (path: string) => Promise<string | null>;
  importModule: (path: string) => Promise<Record<string, unknown>>;
}

interface EntryDispatch {
  entry: string;
  baseDir: string;
  root: string;
  path: string | null;
  remote: boolean;
}

interface WalkOptions {
  env: BosEnv;
  registry?: string;
  io: ResolvedIo;
  collectCatalogs: boolean;
  visit?: (link: WalkLink) => Promise<void>;
  registerCleanup?: (fn: () => Promise<void>) => void;
}

interface SessionParts {
  config: BosConfig;
  runtime: RuntimeConfig;
  root: string;
  path: string | null;
  chain: string[];
  rawConfig: BosConfigInput | null;
  catalog: Record<string, string> | null;
  repository: string | undefined;
  env: BosEnv;
  warnings: string[];
}

async function defaultImportModule(path: string): Promise<Record<string, unknown>> {
  return import(/* webpackIgnore: true */ pathToFileURL(path).href);
}

function resolveIo(io?: ResolutionIo): ResolvedIo {
  return {
    fetchBosConfig:
      io?.fetchBosConfig ??
      (async (bosUrl, registry) => fetchBosConfigFromFastKv(bosUrl, registry)),
    readFileOrNull:
      io?.readFileOrNull ??
      (async (path) => (existsSync(path) ? readFileSync(path, "utf-8") : null)),
    importModule: io?.importModule ?? defaultImportModule,
  };
}

async function loadNodeConfig(
  ref: string,
  baseDir: string,
  io: ResolvedIo,
  registry?: string,
): Promise<BosConfigInput> {
  if (ref.startsWith("bos://")) {
    return (await io.fetchBosConfig(ref, registry)) as BosConfigInput;
  }

  const resolvedPath = isAbsolute(ref) ? ref : resolve(baseDir, ref);
  if (isAppDescriptorPath(resolvedPath)) {
    return io.importModule === defaultImportModule
      ? loadAppDescriptorConfig(resolvedPath)
      : parseAppDescriptorModule(await io.importModule(resolvedPath), resolvedPath);
  }

  const content = await io.readFileOrNull(resolvedPath);
  if (content === null) {
    throw new ConfigLoadError({
      path: resolvedPath,
      message: `Config file not found: ${resolvedPath}`,
    });
  }
  return JSON.parse(content) as BosConfigInput;
}

async function walkExtends(
  ref: string,
  baseDir: string,
  visited: Set<string>,
  chain: string[],
  options: WalkOptions,
): Promise<BosConfigInput> {
  if (visited.has(ref)) {
    throw new CircularExtendsError({
      chain: [...visited, ref],
      message: `Circular extends detected: ${[...visited, ref].join(" -> ")}`,
    });
  }

  let config: BosConfigInput;
  let nodeBaseDir = baseDir;
  let sourceDir: string | undefined;

  if (ref.startsWith("bos://") && options.collectCatalogs) {
    const parsed = parseBosRef(ref);
    if (!parsed) {
      throw new ConfigLoadError({ path: ref, message: `Invalid bos ref: ${ref}` });
    }
    const sourceResult = await resolveSourceDir({
      extendsAccount: parsed.account,
      extendsGateway: parsed.gateway,
    });
    config = sourceResult.parentConfig as BosConfigInput;
    sourceDir = sourceResult.sourceDir || undefined;
    options.registerCleanup?.(sourceResult.cleanup);
    nodeBaseDir = sourceDir ?? baseDir;
  } else if (ref.startsWith("bos://")) {
    config = await loadNodeConfig(ref, baseDir, options.io, options.registry);
  } else {
    const resolvedPath = isAbsolute(ref) ? ref : resolve(baseDir, ref);
    nodeBaseDir = dirname(resolvedPath);
    config = await loadNodeConfig(ref, nodeBaseDir, options.io, options.registry);
  }

  chain.push(ref);

  const extendsRef = config.extends
    ? resolveExtendsRef(config.extends as string | ExtendsConfig, options.env)
    : undefined;

  if (!extendsRef) {
    await options.visit?.({ ref, config, baseDir: nodeBaseDir, sourceDir, isLeaf: true });
    return config;
  }

  const parsedParentRef = parseExtendsTarget(extendsRef);
  const parentBaseDir = getConfigBaseDir(parsedParentRef.configPath, nodeBaseDir);

  if (
    options.collectCatalogs &&
    !canResolveExtendsRef(parsedParentRef.configPath, sourceDir ?? nodeBaseDir)
  ) {
    await options.visit?.({ ref, config, baseDir: nodeBaseDir, sourceDir, isLeaf: true });
    return config;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(ref);
  const parent = await walkExtends(
    parsedParentRef.configPath,
    parentBaseDir,
    nextVisited,
    chain,
    options,
  );

  await options.visit?.({ ref, config, baseDir: nodeBaseDir, sourceDir, isLeaf: false });
  return mergeBosConfigWithExtends(parent, config);
}

function canResolveExtendsRef(parentRef: string, baseDir: string | undefined): boolean {
  if (parentRef.startsWith("bos://")) {
    return parseBosRef(parentRef) !== null;
  }
  if (!baseDir) {
    return false;
  }
  return existsSync(resolve(baseDir, parentRef));
}

function dispatchEntry(request: ResolutionRequest | undefined, cwd: string): EntryDispatch | null {
  if (request?.path) {
    const configPath = request.path;
    if (configPath.startsWith("bos://")) {
      return { entry: configPath, baseDir: cwd, root: cwd, path: configPath, remote: true };
    }
    const baseDir = dirname(configPath);
    return { entry: configPath, baseDir, root: baseDir, path: configPath, remote: false };
  }

  if (request?.bosUrl) {
    return { entry: request.bosUrl, baseDir: cwd, root: cwd, path: null, remote: true };
  }

  if (request?.account) {
    if (!request.gateway) {
      throw new ConfigExtendsError({
        message: `Remote account "${request.account}" requires a gateway`,
      });
    }
    return {
      entry: `bos://${request.account}/${request.gateway}`,
      baseDir: cwd,
      root: cwd,
      path: null,
      remote: true,
    };
  }

  if (request?.sourceDir) {
    const sourceRoot = resolve(request.sourceDir);
    const configPath = findConfigPath(sourceRoot);
    if (!configPath) return null;
    const baseDir = dirname(configPath);
    return { entry: configPath, baseDir, root: sourceRoot, path: configPath, remote: false };
  }

  const configPath = findConfigPath(cwd);
  if (!configPath) {
    return null;
  }
  const baseDir = dirname(configPath);
  return { entry: configPath, baseDir, root: baseDir, path: configPath, remote: false };
}

function isConfigNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("No config found for ");
}

export class ResolutionSession {
  readonly config: BosConfig | null;
  readonly runtime: RuntimeConfig | null;
  readonly root: string;
  readonly path: string | null;
  readonly chain: readonly string[];
  readonly rawConfig: BosConfigInput | null;
  readonly catalog: Record<string, string> | null;
  readonly repository: string | undefined;

  #env: BosEnv;
  #warnings: string[];

  constructor(parts: SessionParts) {
    this.config = parts.config;
    this.runtime = parts.runtime;
    this.root = parts.root;
    this.path = parts.path;
    this.chain = parts.chain;
    this.rawConfig = parts.rawConfig;
    this.catalog = parts.catalog;
    this.repository = parts.repository;
    this.#env = parts.env;
    this.#warnings = parts.warnings;
  }

  static fromParts(parts: {
    config: BosConfig;
    runtime: RuntimeConfig;
    root: string;
    source?: { path?: string; extended?: string[]; remote?: boolean };
    warnings?: string[];
  }): ResolutionSession {
    return new ResolutionSession({
      config: parts.config,
      runtime: parts.runtime,
      root: parts.root,
      path: parts.source?.path ?? null,
      chain: parts.source?.extended ?? [],
      rawConfig: null,
      catalog: null,
      repository: undefined,
      env: defaultConfigEnv(),
      warnings: [...(parts.warnings ?? [])],
    });
  }

  get warnings(): readonly string[] {
    const drained = [...this.#warnings];
    this.#warnings.length = 0;
    return drained;
  }

  async buildRuntime(sources?: RuntimeSources): Promise<RuntimeConfig> {
    if (!this.config) {
      throw new ConfigNotfoundError({
        message: "No config loaded in this resolution session",
      });
    }
    const config = this.config;
    const env = sources?.env ?? this.#env;
    return runWithConfigWarningSink(this.#warnings, () =>
      buildRuntimeConfig(config, this.root, env, {
        plugins: (sources?.plugins ?? {}) as Record<string, RuntimePluginConfig>,
        uiSource: sources?.uiSource,
        apiSource: sources?.apiSource,
        authSource: sources?.authSource,
        hostSource: sources?.hostSource,
      }),
    );
  }
}

/**
 * Opens a resolution session for the requested config source. In development,
 * a local leaf's `bos.dev.ts` overlay (beside the discovered entry config) is
 * merged child-wins over the extended input before parsing; overlays are never
 * read for `bos://` entries or in production/staging.
 */
export async function openResolution(
  request?: ResolutionRequest,
  io?: ResolutionIo,
): Promise<ResolutionSession | null> {
  const resolvedIo = resolveIo(io);
  const env = request?.env ?? defaultConfigEnv();
  const runtimeEnv: BosEnv = env === "staging" ? "production" : env;
  const cwd = request?.cwd ?? process.cwd();
  const collectCatalogs = request?.collectCatalogs === true;

  const warnings: string[] = [];
  const cleanups: Array<() => Promise<void>> = [];

  try {
    const parts = await runWithConfigWarningSink(warnings, async () => {
      const dispatch = dispatchEntry(request, cwd);
      if (!dispatch) return null;

      const chain: string[] = [];
      const catalogs: Record<string, string>[] = [];
      let repository: string | undefined;
      let rawConfig: BosConfigInput | undefined;

      try {
        const mergedRaw = await walkExtends(dispatch.entry, dispatch.baseDir, new Set(), chain, {
          env,
          registry: request?.registry,
          io: resolvedIo,
          collectCatalogs,
          registerCleanup: (fn) => cleanups.push(fn),
          visit: async (link) => {
            if (link.ref === dispatch.entry) {
              rawConfig = link.config;
            }
            if (!collectCatalogs) return;
            catalogs.push(link.sourceDir ? readWorkspaceCatalog(link.sourceDir) : {});
            const repositoryValue = (link.config as Record<string, unknown>).repository;
            if (typeof repositoryValue === "string") {
              repository = repositoryValue;
            }
          },
        });

        let overlayMerged = mergedRaw;
        if (env === "development" && !dispatch.remote) {
          const overlayPath = join(dirname(dispatch.entry), DEV_OVERLAY_FILENAME);
          if ((await resolvedIo.readFileOrNull(overlayPath)) !== null) {
            const overlay = parseDevOverlayModule(
              await resolvedIo.importModule(overlayPath),
              overlayPath,
            );
            overlayMerged = applyDevOverlay(mergedRaw, overlay);
          }
        }

        const config = await resolveConfigComposableEntries(
          BosConfigSchema.parse(overlayMerged),
          dispatch.baseDir,
          runtimeEnv,
        );
        const pluginRuntime =
          (await buildRuntimePluginsForConfig(
            config,
            dispatch.baseDir,
            runtimeEnv,
            request?.remotePlugins,
          )) ?? {};
        const runtime = await buildRuntimeConfig(config, dispatch.baseDir, runtimeEnv, {
          plugins: pluginRuntime,
        });

        return {
          config,
          runtime,
          root: dispatch.root,
          path: dispatch.path,
          chain,
          rawConfig: rawConfig ?? null,
          catalog: collectCatalogs ? Object.assign({}, ...[...catalogs].reverse()) : null,
          repository,
        } satisfies Omit<SessionParts, "env" | "warnings">;
      } catch (error) {
        if (dispatch.remote && isConfigNotFound(error)) {
          return null;
        }
        throw error;
      }
    });

    if (!parts) return null;

    return new ResolutionSession({
      ...parts,
      env: runtimeEnv,
      warnings,
    });
  } finally {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }
  }
}

export async function walkExtendsChain(
  entry: string,
  options: {
    env?: BosEnv;
    io?: ResolutionIo;
    registry?: string;
    collectCatalogs?: boolean;
    visit(link: WalkLink): Promise<void>;
    registerCleanup?(fn: () => Promise<void>): void;
  },
): Promise<{ chain: string[]; config: BosConfigInput }> {
  const baseDir = entry.startsWith("bos://") ? process.cwd() : dirname(entry);
  const chain: string[] = [];
  const ownedCleanups: Array<() => Promise<void>> = [];
  try {
    const config = await walkExtends(entry, baseDir, new Set(), chain, {
      env: options.env ?? "development",
      registry: options.registry,
      io: resolveIo(options.io),
      collectCatalogs: options.collectCatalogs === true,
      visit: options.visit,
      registerCleanup: options.registerCleanup ?? ((fn) => ownedCleanups.push(fn)),
    });
    return { chain, config };
  } finally {
    for (const cleanup of [...ownedCleanups].reverse()) {
      await cleanup();
    }
  }
}

/**
 * @internal — resolves the fully merged (parent-merged, un-parsed)
 * `BosConfigInput` for a config entry. Used by config.ts's
 * `resolveComposableReference` for plugin-entry extends resolution.
 */
export async function resolveMergedConfigInput(
  entry: string,
  options?: { baseDir?: string; env?: BosEnv; io?: ResolutionIo; registry?: string },
): Promise<BosConfigInput> {
  const baseDir = options?.baseDir ?? process.cwd();
  return walkExtends(entry, baseDir, new Set(), [], {
    env: options?.env ?? "development",
    registry: options?.registry,
    io: resolveIo(options?.io),
    collectCatalogs: false,
  });
}
