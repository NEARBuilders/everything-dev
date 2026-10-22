import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Schema } from "effect";
import { resolveApp, toConfigInput } from "../../descriptor/resolve";
import { type AppDescriptor, AppDescriptorSchema } from "../../descriptor/schema";
import type { BosConfig, BosConfigInput, BosPluginRef } from "../../types";
import { fetchBosConfigFromFastKv } from "../registry/fastkv";
import { type BosEnv, bosConfigMerger, isPlainObject, resolveExtendsRef } from "./merge";

export const LOCAL_PREFIX = "local:";
export const MISSING_CONFIG_MESSAGE = "No config found (bos.app.ts or bos.config.json)";

export const DEV_OVERLAY_FILENAME = "bos.dev.ts";

interface ConfigWarningCapture {
  sink: string[];
  previous: ConfigWarningCapture | undefined;
}

const warningCapture = new AsyncLocalStorage<ConfigWarningCapture | undefined>();

/**
 * @internal — runs `fn` with config warnings captured into `sink` instead of
 * the console. Plumbing for the resolution session; not part of the public
 * config surface.
 */
export function runWithConfigWarningSink<T>(sink: string[], fn: () => T): T {
  return warningCapture.run({ sink, previous: warningCapture.getStore() }, fn);
}

export function emitConfigWarning(message: string): void {
  const capture = warningCapture.getStore();
  if (capture) {
    capture.sink.push(message);
  } else {
    console.warn(message);
  }
}

const configPathCache = new Map<string, string | null>();

/**
 * @internal — clears the findConfigPath memo. Plumbing for tests and the
 * resolution session; not part of the public config surface.
 */
export function resetConfigPathCache(): void {
  configPathCache.clear();
}

/**
 * Reads the local authored config without resolving the extends chain or
 * touching the network — the build-surface factories (generated rsbuild
 * configs) consume it for their APP_NAME/APP_ACCOUNT defines.
 */
export async function readAuthoredConfigInput(cwd?: string): Promise<BosConfigInput | null> {
  const configPath = findConfigPath(cwd);
  if (!configPath || configPath.startsWith("bos://")) return null;
  return readConfigInput(configPath, dirname(configPath));
}

/**
 * The authored config entry inside exactly `dir` — no upward walk. Unlike
 * `findConfigPath` this never escapes the given directory, for write targets
 * and nested-local-path resolution where a parent's config must not be
 * picked up. Prefers the authored `bos.app.ts` descriptor (the canonical
 * form) over a legacy `bos.config.json`.
 */
export function localConfigEntryPath(dir: string): string | null {
  const appPath = join(dir, "bos.app.ts");
  if (existsSync(appPath)) return appPath;
  const jsonPath = join(dir, "bos.config.json");
  return existsSync(jsonPath) ? jsonPath : null;
}

/** `localConfigEntryPath` + the form-aware read (`BosConfigInput`). */
export async function readLocalAuthoredConfigInput(dir: string): Promise<BosConfigInput | null> {
  const entry = localConfigEntryPath(dir);
  if (!entry) return null;
  return readConfigInput(entry, dirname(entry));
}

/**
 * The authored `bos.app.ts` descriptor is the canonical form — when both
 * forms coexist (e.g. a generated `bos.config.json` write-back beside the
 * authored descriptor), the authored file wins. JSON-form-only children are
 * unaffected: with no `bos.app.ts`, the JSON file is the entry.
 */
export function findConfigPath(cwd?: string): string | null {
  const cacheKey = resolve(cwd ?? process.cwd());
  const cached = configPathCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let dir = cacheKey;
  while (true) {
    const appPath = join(dir, "bos.app.ts");
    if (existsSync(appPath)) {
      configPathCache.set(cacheKey, appPath);
      return appPath;
    }
    const jsonPath = join(dir, "bos.config.json");
    if (existsSync(jsonPath)) {
      configPathCache.set(cacheKey, jsonPath);
      return jsonPath;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  configPathCache.set(cacheKey, null);
  return null;
}

export function isAppDescriptorPath(configPath: string): boolean {
  return configPath.endsWith(".app.ts") || configPath.endsWith(".app.js");
}

/**
 * Materialize an authored bos.app.ts descriptor into the authoring-shape
 * `BosConfigInput` the config pipeline consumes. Import-extends is honored
 * two ways: the parent descriptor value can be imported directly (an
 * inlined parent, resolved through `resolveApp`), or `extends` can name a
 * published config (`bos://…`) / a local file, which flows into the JSON
 * extends chain unchanged.
 */
export async function loadAppDescriptorConfig(resolvedPath: string): Promise<BosConfigInput> {
  // webpackIgnore: the path is inherently runtime-resolved — bundlers must
  // not try to statically analyze it (rsbuild otherwise warns "Critical
  // dependency: the request of a dependency is an expression").
  const mod = (await import(/* webpackIgnore: true */ pathToFileURL(resolvedPath).href)) as Record<
    string,
    unknown
  >;
  return parseAppDescriptorModule(mod, resolvedPath);
}

/**
 * Evaluate an authored descriptor's source text in-process: descriptor-constructor
 * imports (`App`/`API`/`UI`/`Plugin` from `everything-dev/descriptor`) are
 * stubbed with pure-identity shims and the remaining module body is imported
 * from a data URL. Byte-deterministic — no bundler resolution of the
 * descriptor package and no module-cache interference (a tempdir child has no
 * node_modules, so a real dynamic import is both fragile and here served
 * stale, mangled transforms under vitest).
 */
export async function loadInProcessDescriptor(
  source: string,
  label: string,
): Promise<BosConfigInput> {
  const body = source
    .split("\n")
    .filter((line) => !/^\s*import\b/.test(line))
    .join("\n");
  const shims = [
    "const App = (input) => input;",
    "const API = (input) => input;",
    "const UI = (input) => input;",
    "const Plugin = (name) => ({ path: (dir, extra = {}) => ({ ...extra, name, path: dir }), extends: (ref, extra = {}) => ({ ...extra, name, extends: ref }) });",
  ].join("\n");
  const encoded = Buffer.from(`${shims}\n${body}`, "utf-8").toString("base64");
  // webpackIgnore: the data URL is runtime-resolved (Node imports it natively)
  // — bundlers must not try to statically analyze the specifier (rspack
  // otherwise fails the dist build with "Can't resolve 'data:text'").
  const mod = (await import(
    /* webpackIgnore: true */ `data:text/javascript;base64,${encoded}`
  )) as Record<string, unknown>;
  return parseAppDescriptorModule(mod, label);
}

/**
 * @internal — parses an already-imported app descriptor module into the
 * authoring-shape `BosConfigInput`. Plumbing for the resolution session's
 * injectable module loader; not part of the public config surface.
 */
export function parseAppDescriptorModule(
  mod: Record<string, unknown>,
  sourcePath?: string,
): BosConfigInput {
  if (!mod.default) {
    throw new Error(
      `${sourcePath ?? "App descriptor module"} must default-export an App() descriptor`,
    );
  }
  const descriptor = AppDescriptorSchema.parse(mod.default);

  // Registry candidates: named exports that parse as App descriptors.
  const registry: Record<string, unknown> = {};
  for (const value of Object.values(mod)) {
    const parsed = AppDescriptorSchema.safeParse(value);
    if (parsed.success) registry[parsed.data.name] = parsed.data;
  }

  const extendsRef = descriptor.extends;
  const inRegistry = typeof extendsRef === "string" && registry[extendsRef] !== undefined;
  const importedParent = extendsRef !== undefined && typeof extendsRef !== "string";

  if (inRegistry || importedParent) {
    return resolveApp(descriptor.name, registry as never);
  }

  const input = toConfigInput(descriptor);
  if (extendsRef !== undefined) {
    input.extends = extendsRef as BosConfigInput["extends"];
  }
  return input;
}

/**
 * @internal — validates an already-imported `bos.dev.ts` module as a
 * `Partial<AppDescriptor>` dev overlay. Plumbing for the resolution session's
 * injectable module loader; not part of the public config surface.
 */
export function parseDevOverlayModule(
  mod: Record<string, unknown>,
  sourcePath?: string,
): Partial<AppDescriptor> {
  const source = sourcePath ?? DEV_OVERLAY_FILENAME;
  if (!mod?.default) {
    throw new DevOverlayError({
      path: source,
      message: `${source} must default-export a dev overlay (Partial<AppDescriptor>)`,
    });
  }
  const parsed = AppDescriptorSchema.partial().safeParse(mod.default);
  if (!parsed.success) {
    throw new DevOverlayError({
      path: source,
      message: `${source} is not a valid dev overlay: ${parsed.error.message}`,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export interface ResolvedComposableReference {
  entry: BosPluginRef;
  providerBaseDir: string;
  targetPath: string;
  associatedUi?: Record<string, unknown>;
}

interface ParsedExtendsTarget {
  configPath: string;
  targetPath?: string;
}

export class ConfigLoadError extends Schema.TaggedError<ConfigLoadError>()("ConfigLoadError", {
  path: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class CircularExtendsError extends Schema.TaggedError<CircularExtendsError>()(
  "CircularExtendsError",
  { chain: Schema.Array(Schema.String), message: Schema.String },
) {}

export class ConfigNotfoundError extends Schema.TaggedError<ConfigNotfoundError>()(
  "ConfigNotfoundError",
  { message: Schema.String },
) {}

export class ConfigExtendsError extends Schema.TaggedError<ConfigExtendsError>()(
  "ConfigExtendsError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class ConfigVersionManifestError extends Schema.TaggedError<ConfigVersionManifestError>()(
  "ConfigVersionManifestError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class DevOverlayError extends Schema.TaggedError<DevOverlayError>()("DevOverlayError", {
  path: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export function defaultConfigEnv(): BosEnv {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function getEntryAssociatedUi(
  entry: Partial<BosPluginRef>,
): Record<string, unknown> | undefined {
  const flat = isPlainObject(entry.ui) ? (entry.ui as Record<string, unknown>) : undefined;
  const nested = (() => {
    if (!isPlainObject(entry.app)) return undefined;
    const app = entry.app as Record<string, unknown>;
    return isPlainObject(app.ui) ? (app.ui as Record<string, unknown>) : undefined;
  })();
  const ui = flat ?? nested;
  if (!ui) return undefined;

  if ("shared" in ui) {
    throw new ConfigExtendsError({
      message:
        "app.ui.shared is no longer supported. Move shared deps to app.api.shared, app.auth.shared, or plugins.*.shared.",
    });
  }

  return ui;
}

function mergeAssociatedUi(
  parentUi: Record<string, unknown> | undefined,
  childUi: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!parentUi) {
    return childUi ? { ...childUi } : undefined;
  }

  if (!childUi) {
    return { ...parentUi };
  }

  return bosConfigMerger({ ...childUi }, parentUi) as Record<string, unknown>;
}

function withAssociatedUi(
  entry: BosPluginRef,
  associatedUi?: Record<string, unknown>,
): BosPluginRef {
  if (!associatedUi) {
    return entry;
  }

  const app = isPlainObject(entry.app)
    ? ({ ...(entry.app as Record<string, unknown>) } as Record<string, unknown>)
    : {};
  app.ui = mergeAssociatedUi(getEntryAssociatedUi(entry), associatedUi);

  return {
    ...entry,
    app,
  };
}

export async function resolveConfigComposableEntries(
  config: BosConfig,
  baseDir: string,
  env: BosEnv,
): Promise<BosConfig> {
  const [resolvedApi, resolvedAuth] = await Promise.all([
    resolveComposableReference(config.app.api as BosPluginRef, baseDir, env, "app.api"),
    config.app.auth
      ? resolveComposableReference(config.app.auth as BosPluginRef, baseDir, env, "app.auth")
      : Promise.resolve(undefined),
  ]);

  const resolvedPlugins = config.plugins
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(config.plugins).map(async ([pluginId, pluginValue]) => {
            const resolvedPlugin = await resolveComposableReference(
              asComposableEntry(pluginValue),
              baseDir,
              env,
              `plugins.${pluginId}`,
            );

            return [
              pluginId,
              withAssociatedUi(resolvedPlugin.entry, resolvedPlugin.associatedUi),
            ] as const;
          }),
        ),
      )
    : undefined;

  return {
    ...config,
    app: {
      ...config.app,
      api: resolvedApi.entry,
      auth: resolvedAuth?.entry,
    },
    plugins: resolvedPlugins,
  };
}

/**
 * @internal — splits an extends ref into its config path and optional
 * `#target` suffix. Plumbing for the resolution session; not part of the
 * public config surface.
 */
export function parseExtendsTarget(ref: string): ParsedExtendsTarget {
  const hashIndex = ref.indexOf("#");
  if (hashIndex === -1) {
    return { configPath: ref };
  }

  const configPath = ref.slice(0, hashIndex);
  const targetPath = ref.slice(hashIndex + 1);
  return {
    configPath,
    targetPath: targetPath.length > 0 ? targetPath : undefined,
  };
}

/**
 * @internal — resolves the base directory a config path extends from.
 * Plumbing for the resolution session; not part of the public config surface.
 */
export function getConfigBaseDir(configPath: string, baseDir: string): string {
  if (configPath.startsWith("bos://")) return baseDir;
  return dirname(isAbsolute(configPath) ? configPath : resolve(baseDir, configPath));
}

function asComposableEntry(value: unknown): BosPluginRef {
  if (value === undefined) {
    return {};
  }
  if (typeof value === "string") {
    return { extends: value };
  }
  if (!isPlainObject(value)) {
    throw new ConfigExtendsError({
      message: `Expected config entry object, received ${typeof value}`,
    });
  }
  return value as BosPluginRef;
}

function getTargetedEntry(config: BosConfigInput, targetPath: string): BosPluginRef {
  if (targetPath.startsWith("app.")) {
    const entryKey = targetPath.slice("app.".length);
    return asComposableEntry(config.app?.[entryKey]);
  }

  if (targetPath.startsWith("plugins.")) {
    const pluginId = targetPath.slice("plugins.".length);
    if (pluginId.length === 0) {
      throw new ConfigExtendsError({ message: `Invalid plugin target path: ${targetPath}` });
    }
    return asComposableEntry(config.plugins?.[pluginId]);
  }

  throw new ConfigExtendsError({ message: `Unsupported extends target path: ${targetPath}` });
}

function getAssociatedUi(
  config: BosConfigInput,
  _targetPath: string,
): Record<string, unknown> | undefined {
  if (!isPlainObject(config.app?.ui)) {
    return undefined;
  }

  const ui = config.app.ui as Record<string, unknown>;
  if ("shared" in ui) {
    throw new ConfigExtendsError({
      message:
        "app.ui.shared is no longer supported. Move shared deps to app.api.shared, app.auth.shared, or plugins.*.shared.",
    });
  }

  return ui;
}

function applyNullOverrides(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === null) {
      target[key] = null;
    } else if (isPlainObject(value) && isPlainObject(target[key])) {
      applyNullOverrides(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    }
  }
}

function mergeComposableEntries(
  parent: Partial<BosPluginRef>,
  child: Partial<BosPluginRef>,
): BosPluginRef {
  const merged = bosConfigMerger({ ...child }, parent) as Record<string, unknown>;
  applyNullOverrides(merged, child as Record<string, unknown>);
  return merged as BosPluginRef;
}

function stripUnsafeLocalDevelopment<T extends Record<string, unknown> | undefined>(
  entry: T,
  allowLocalPaths: boolean,
): T {
  if (!entry || allowLocalPaths) {
    return entry;
  }

  if (typeof entry.development === "string" && entry.development.startsWith(LOCAL_PREFIX)) {
    const { development: _ignored, ...rest } = entry;
    return rest as T;
  }

  return entry;
}

export async function resolveComposableReference(
  source: BosPluginRef,
  baseDir: string,
  env: BosEnv,
  defaultTargetPath: string,
): Promise<ResolvedComposableReference> {
  let resolvedEntry: BosPluginRef = {};
  let providerBaseDir = baseDir;
  let targetPath = defaultTargetPath;
  let associatedUi = getEntryAssociatedUi(source);
  let allowLocalPaths = false;
  let extendsError: unknown;

  const extendsRef = source.extends ? resolveExtendsRef(source.extends, env) : undefined;
  if (extendsRef) {
    const { resolveMergedConfigInput } = await import("./session");
    const parsed = parseExtendsTarget(extendsRef);
    targetPath = parsed.targetPath ?? defaultTargetPath;
    const extendsBaseDir = getConfigBaseDir(parsed.configPath, baseDir);
    try {
      const extendedConfig = await resolveMergedConfigInput(parsed.configPath, {
        baseDir: extendsBaseDir,
        env,
      });
      resolvedEntry = mergeComposableEntries(
        resolvedEntry,
        getTargetedEntry(extendedConfig, targetPath),
      );
      providerBaseDir = extendsBaseDir;
      associatedUi = mergeAssociatedUi(associatedUi, getAssociatedUi(extendedConfig, targetPath));
    } catch (error) {
      extendsError = error;
    }
  }

  const localDevelopment =
    typeof source.development === "string" && source.development.startsWith(LOCAL_PREFIX)
      ? source.development
      : undefined;
  const localDevelopmentPath = localDevelopment
    ? resolve(baseDir, localDevelopment.slice(LOCAL_PREFIX.length).trim())
    : undefined;
  const hasUsableLocalDevelopment = Boolean(
    localDevelopmentPath && existsSync(localDevelopmentPath),
  );

  if (localDevelopmentPath) {
    const { resolveMergedConfigInput } = await import("./session");
    const localPath = localDevelopmentPath;
    const localConfigPath = localConfigEntryPath(localPath);
    if (localConfigPath) {
      const localConfig = await resolveMergedConfigInput(localConfigPath, {
        baseDir: localPath,
        env,
      });
      resolvedEntry = mergeComposableEntries(
        resolvedEntry,
        getTargetedEntry(localConfig, targetPath),
      );
      providerBaseDir = localPath;
      associatedUi = mergeAssociatedUi(associatedUi, getAssociatedUi(localConfig, targetPath));
      allowLocalPaths = true;
    }
  }

  const sourceOverrides = { ...source };
  if (allowLocalPaths && localDevelopment) {
    delete sourceOverrides.development;
  }

  resolvedEntry = mergeComposableEntries(resolvedEntry, sourceOverrides);
  associatedUi = mergeAssociatedUi(associatedUi, getEntryAssociatedUi(sourceOverrides));

  if (extendsError && !allowLocalPaths && !hasUsableLocalDevelopment) {
    throw extendsError;
  }

  return {
    entry: stripUnsafeLocalDevelopment(resolvedEntry, allowLocalPaths || Boolean(localDevelopment)),
    providerBaseDir,
    targetPath,
    // A plugin's own ui lives under its local development tree — the same
    // safety argument as the entry itself: keep its local target when the
    // plugin resolves locally, or the folder-form ui surface silently
    // disappears (no BOS_UI_PORT, an unassigned ui dev server, and a
    // port collision with another plugin's ui slot).
    associatedUi: stripUnsafeLocalDevelopment(
      associatedUi,
      allowLocalPaths || Boolean(localDevelopment),
    ),
  };
}

async function readConfigInput(configPath: string, baseDir: string): Promise<BosConfigInput> {
  if (configPath.startsWith("bos://")) {
    return fetchBosConfigFromFastKv<BosConfigInput>(configPath);
  }

  const resolvedPath = isAbsolute(configPath) ? configPath : resolve(baseDir, configPath);
  if (isAppDescriptorPath(resolvedPath)) {
    return loadAppDescriptorConfig(resolvedPath);
  }
  return JSON.parse(readFileSync(resolvedPath, "utf-8")) as BosConfigInput;
}
