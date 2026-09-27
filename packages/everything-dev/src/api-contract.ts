import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { buildAuthExportStub, buildAuthTypesGenContent } from "./auth-types-gen";
import { fetchJsonOrNull, fetchResponse } from "./http-client";
import { isAuthMirrorPluginEntry } from "./service-descriptor";
import type { JsonObject, RuntimeConfig, RuntimePluginConfig } from "./types";

export interface ApiPluginManifest {
  schemaVersion: 1;
  kind: "every-plugin/manifest";
  plugin: {
    name: string;
    version: string;
  };
  runtime: {
    remoteEntry: string;
  };
  contract?: {
    kind: "orpc";
    types: {
      path: string;
      exportName: string;
      typeName: string;
      sha256?: string;
    };
  };
  additionalExports?: Array<{
    path: string;
    exports: string[];
    sha256?: string;
  }>;
  plugins?: Array<{
    key: string;
    name: string;
    url: string;
    dependsOn?: string[];
    secrets?: string[];
    variables?: JsonObject;
  }>;
  dependsOn?: string[];
}

export class ApiManifestFetchError extends Schema.TaggedError<ApiManifestFetchError>()(
  "ApiManifestFetchError",
  { url: Schema.String, message: Schema.String },
) {}

export class ApiManifestFormatError extends Schema.TaggedError<ApiManifestFormatError>()(
  "ApiManifestFormatError",
  { url: Schema.String, message: Schema.String },
) {}

export class MissingContractTypesError extends Schema.TaggedError<MissingContractTypesError>()(
  "MissingContractTypesError",
  { pluginName: Schema.String, message: Schema.String },
) {}

export class ContractTypesFetchError extends Schema.TaggedError<ContractTypesFetchError>()(
  "ContractTypesFetchError",
  { url: Schema.String, message: Schema.String },
) {}

export class ContractTypesChecksumError extends Schema.TaggedError<ContractTypesChecksumError>()(
  "ContractTypesChecksumError",
  { url: Schema.String, message: Schema.String },
) {}

export class AuthExportFetchError extends Schema.TaggedError<AuthExportFetchError>()(
  "AuthExportFetchError",
  { url: Schema.String, message: Schema.String },
) {}

export type ApiContractError =
  | ApiManifestFetchError
  | ApiManifestFormatError
  | MissingContractTypesError
  | ContractTypesFetchError
  | ContractTypesChecksumError;

export class ApiContractResolver extends Context.Service<
  ApiContractResolver,
  {
    manifest: (
      apiBaseUrl: string,
    ) => Effect.Effect<ApiPluginManifest, ApiManifestFetchError | ApiManifestFormatError>;
    contractSource: (opts: {
      baseUrl: string;
      runtimeDir: string;
      name: string;
      generatedSubdir: string;
    }) => Effect.Effect<ContractSource, ApiContractError>;
    authExportTypes: (opts: {
      baseUrl: string;
      runtimeDir: string;
      manifest: ApiPluginManifest;
    }) => Effect.Effect<string | null, AuthExportFetchError>;
  }
>()("everything-dev/api-contract/ApiContractResolver") {
  static readonly layer: Layer.Layer<ApiContractResolver> = Layer.effect(
    ApiContractResolver,
    Effect.gen(function* () {
      const manifest = Effect.fn("ApiContractResolver.manifest")(function* (
        apiBaseUrl: string,
      ): Effect.fn.Return<ApiPluginManifest, ApiManifestFetchError | ApiManifestFormatError> {
        const url = getApiPluginManifestUrl(apiBaseUrl);
        const fetched = yield* Effect.tryPromise({
          try: () => fetchJsonOrNull<ApiPluginManifest>(url, { retries: 2 }),
          catch: () =>
            new ApiManifestFetchError({
              url,
              message: `Failed to fetch API plugin manifest from ${url}`,
            }),
        });
        if (!fetched) {
          return yield* new ApiManifestFetchError({
            url,
            message: `Failed to fetch API plugin manifest from ${url}`,
          });
        }
        if (fetched.schemaVersion !== 1 || fetched.kind !== "every-plugin/manifest") {
          return yield* new ApiManifestFormatError({
            url,
            message: "Unsupported API plugin manifest format",
          });
        }
        return fetched;
      });

      const writeContractTypes = Effect.fn("ApiContractResolver.writeContractTypes")(
        function* (opts: {
          contractUrl: string;
          manifest: ApiPluginManifest;
          runtimeDir: string;
          generatedSubdir: string;
          name: string;
        }): Effect.fn.Return<ContractSource, ContractTypesFetchError | ContractTypesChecksumError> {
          const contractResponse = yield* Effect.tryPromise({
            try: () => fetchResponse(opts.contractUrl),
            catch: () =>
              new ContractTypesFetchError({
                url: opts.contractUrl,
                message: `Failed to fetch contract types from ${opts.contractUrl}`,
              }),
          });
          if (!contractResponse.ok) {
            return yield* new ContractTypesFetchError({
              url: opts.contractUrl,
              message: `Failed to fetch contract types from ${opts.contractUrl}: ${contractResponse.status} ${contractResponse.statusText}`,
            });
          }

          const contractTypes = yield* Effect.tryPromise({
            try: () => contractResponse.text(),
            catch: () =>
              new ContractTypesFetchError({
                url: opts.contractUrl,
                message: `Failed to fetch contract types from ${opts.contractUrl}`,
              }),
          });
          if (
            opts.manifest.contract?.types.sha256 &&
            opts.manifest.contract.types.sha256 !== sha256(contractTypes)
          ) {
            return yield* new ContractTypesChecksumError({
              url: opts.contractUrl,
              message: "Fetched contract types failed checksum verification",
            });
          }

          const generatedPath = join(opts.runtimeDir, opts.generatedSubdir, "contract.d.ts");
          yield* Effect.sync(() => {
            mkdirSync(dirname(generatedPath), { recursive: true });
            writeFileIfChanged(generatedPath, contractTypes);
          });

          return {
            key: opts.name,
            importName: `${sanitizeIdentifier(opts.name)}Contract`,
            sourceFilePath: generatedPath,
            generatedPath,
          };
        },
      );

      const contractSource = Effect.fn("ApiContractResolver.contractSource")(function* (opts: {
        baseUrl: string;
        runtimeDir: string;
        name: string;
        generatedSubdir: string;
      }): Effect.fn.Return<ContractSource, ApiContractError> {
        const fetchedManifest = yield* manifest(opts.baseUrl);
        if (!fetchedManifest.contract) {
          return yield* new MissingContractTypesError({
            pluginName: fetchedManifest.plugin.name,
            message: `Plugin manifest for ${fetchedManifest.plugin.name} does not advertise contract types`,
          });
        }
        const contractUrl = `${trimTrailingSlash(opts.baseUrl)}/${fetchedManifest.contract.types.path.replace(/^\.\//, "")}`;
        return yield* writeContractTypes({
          contractUrl,
          manifest: fetchedManifest,
          runtimeDir: opts.runtimeDir,
          generatedSubdir: opts.generatedSubdir,
          name: opts.name,
        });
      });

      const authExportTypes = Effect.fn("ApiContractResolver.authExportTypes")(function* (opts: {
        baseUrl: string;
        runtimeDir: string;
        manifest: ApiPluginManifest;
      }): Effect.fn.Return<string | null, AuthExportFetchError> {
        const exports = opts.manifest.additionalExports ?? [];
        const entry = exports.find(
          (candidate) =>
            candidate.path.includes("auth-export") || candidate.path.endsWith("auth-export.d.ts"),
        );
        if (!entry) return null;

        const exportUrl = `${trimTrailingSlash(opts.baseUrl)}/${entry.path.replace(/^\.\//, "")}`;
        const response = yield* Effect.tryPromise({
          try: () => fetchResponse(exportUrl),
          catch: () =>
            new AuthExportFetchError({
              url: exportUrl,
              message: `Failed to fetch auth export types from ${exportUrl}`,
            }),
        });
        if (!response.ok) {
          return yield* new AuthExportFetchError({
            url: exportUrl,
            message: `Failed to fetch auth export types from ${exportUrl}: ${response.status}`,
          });
        }

        const content = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () =>
            new AuthExportFetchError({
              url: exportUrl,
              message: `Failed to fetch auth export types from ${exportUrl}`,
            }),
        });
        if (entry.sha256 && entry.sha256 !== sha256(content)) {
          return yield* new AuthExportFetchError({
            url: exportUrl,
            message: `Auth export types checksum mismatch for ${exportUrl}`,
          });
        }

        const generatedPath = join(opts.runtimeDir, "auth", "auth-export.d.ts");
        yield* Effect.sync(() => {
          mkdirSync(dirname(generatedPath), { recursive: true });
          writeFileIfChanged(generatedPath, content);
        });
        return generatedPath;
      });

      return ApiContractResolver.of({ manifest, contractSource, authExportTypes });
    }),
  );
}

let resolverRuntime: ManagedRuntime.ManagedRuntime<ApiContractResolver, never> | null = null;

function getResolver(): ManagedRuntime.ManagedRuntime<ApiContractResolver, never> {
  if (!resolverRuntime) {
    resolverRuntime = ManagedRuntime.make(ApiContractResolver.layer);
  }
  return resolverRuntime;
}

/** Test seam: dispose the cached resolver runtime. */
export function disposeApiContractResolver(): Promise<void> {
  if (!resolverRuntime) return Promise.resolve();
  const runtime = resolverRuntime;
  resolverRuntime = null;
  return runtime.dispose();
}

interface ContractSource {
  key: string;
  importName: string;
  sourceFilePath: string;
  generatedPath?: string;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function trimTrailingSlash(input: string): string {
  return input.replace(/\/$/, "");
}

function sanitizeIdentifier(input: string): string {
  return input.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]+/, "_");
}

function toImportPath(fromFile: string, targetFile: string): string {
  const rel = relative(dirname(fromFile), targetFile).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function writeFileIfChanged(filePath: string, content: string) {
  try {
    if (readFileSync(filePath, "utf8") === content) return false;
  } catch {
    // file does not exist yet
  }

  writeFileSync(filePath, content);
  return true;
}

function getApiPluginManifestUrl(apiBaseUrl: string): string {
  return `${trimTrailingSlash(apiBaseUrl)}/plugin.manifest.json`;
}

export async function fetchApiPluginManifest(apiBaseUrl: string): Promise<ApiPluginManifest> {
  return getResolver()
    .runPromise(
      Effect.gen(function* () {
        const resolver = yield* ApiContractResolver;
        return yield* resolver.manifest(apiBaseUrl);
      }),
    )
    .catch((error: ApiManifestFetchError | ApiManifestFormatError) => {
      throw new Error(error.message);
    });
}

function localApiContractSource(configDir: string): ContractSource {
  const sourcePath = join(configDir, "api", "src", "contract.ts");
  return {
    key: "api",
    importName: "BaseApiContract",
    sourceFilePath: sourcePath,
  };
}

function localAuthContractSource(configDir: string): ContractSource {
  const sourcePath = join(configDir, "plugins", "auth", "src", "contract.ts");
  return {
    key: "auth",
    importName: "authContract",
    sourceFilePath: sourcePath,
  };
}

async function remoteContractSource(opts: {
  configDir: string;
  runtimeDir: string;
  name: string;
  baseUrl: string;
  generatedSubdir: string;
}): Promise<ContractSource> {
  return getResolver()
    .runPromise(
      Effect.gen(function* () {
        const resolver = yield* ApiContractResolver;
        return yield* resolver.contractSource({
          baseUrl: opts.baseUrl,
          runtimeDir: opts.runtimeDir,
          name: opts.name,
          generatedSubdir: opts.generatedSubdir,
        });
      }),
    )
    .catch((error: ApiContractError) => {
      throw new Error(error.message);
    });
}

async function fetchAuthExportTypes(opts: {
  baseUrl: string;
  runtimeDir: string;
  manifest: ApiPluginManifest;
}): Promise<string | null> {
  return getResolver()
    .runPromise(
      Effect.gen(function* () {
        const resolver = yield* ApiContractResolver;
        return yield* resolver.authExportTypes({
          baseUrl: opts.baseUrl,
          runtimeDir: opts.runtimeDir,
          manifest: opts.manifest,
        });
      }),
    )
    .catch((error: AuthExportFetchError) => {
      console.warn(`[API Contract] ${error.message}`);
      return null;
    });
}

async function resolveContractSource(opts: {
  configDir: string;
  runtimeDir: string;
  key: string;
  source: RuntimePluginConfig | { url: string; localPath?: string; name: string } | null;
  baseUrl: string;
  generatedSubdir: string;
  localSourceFactory?: (configDir: string) => ContractSource;
}): Promise<ContractSource> {
  if (opts.key === "api") {
    const localPath = opts.source && "localPath" in opts.source ? opts.source.localPath : undefined;
    if (localPath != null && localPath !== "") {
      return {
        key: opts.key,
        importName: "BaseApiContract",
        sourceFilePath: join(localPath, "src", "contract.ts"),
      };
    }

    if (!opts.baseUrl) {
      return localApiContractSource(opts.configDir);
    }
  }

  if (opts.key === "auth" && opts.localSourceFactory) {
    const localPath = opts.source && "localPath" in opts.source ? opts.source.localPath : undefined;
    if (localPath != null && localPath !== "") {
      return {
        key: opts.key,
        importName: "authContract",
        sourceFilePath: join(localPath, "src", "contract.ts"),
      };
    }

    if (!opts.baseUrl) {
      return opts.localSourceFactory(opts.configDir);
    }
  }

  if (
    opts.source &&
    "localPath" in opts.source &&
    opts.source.localPath != null &&
    opts.source.localPath !== ""
  ) {
    return {
      key: opts.key,
      importName: `${sanitizeIdentifier(opts.key)}Contract`,
      sourceFilePath: join(opts.source.localPath, "src", "contract.ts"),
    };
  }

  return remoteContractSource({
    configDir: opts.configDir,
    runtimeDir: opts.runtimeDir,
    name: opts.key,
    baseUrl: opts.baseUrl,
    generatedSubdir: opts.generatedSubdir,
  });
}

function writePluginClientGen(opts: {
  configDir: string;
  pluginKey: string;
  depSources: ContractSource[];
  localPath: string;
}) {
  const pluginSrcDir = join(opts.localPath, "src");
  if (!existsSync(pluginSrcDir)) return;

  const targetPath = join(pluginSrcDir, "lib", "plugins-client.gen.ts");
  const lines: string[] = [];

  for (const source of opts.depSources) {
    const importPath = toImportPath(targetPath, source.sourceFilePath);
    lines.push(`import type { ContractType as ${source.importName} } from "${importPath}";`);
  }

  lines.push('import type { RouterContractClient, RouterContract } from "@orpc/contract";');
  lines.push('import type { ContractedRouter } from "@orpc/server";');
  lines.push(
    "type PluginClientEntry<C extends RouterContract> = {\n  client: (context?: Record<string, unknown>) => RouterContractClient<C>;\n  router: ContractedRouter<C, any>;\n};",
  );
  lines.push("");

  if (opts.depSources.length === 0) {
    lines.push("export type PluginsClient = Record<string, never>;");
  } else {
    lines.push("export type PluginsClient = {");
    for (const source of opts.depSources) {
      const key = /^[$A-Z_][0-9A-Z_$]*$/i.test(source.key)
        ? source.key
        : JSON.stringify(source.key);
      lines.push(`  ${key}: PluginClientEntry<${source.importName}>;`);
    }
    lines.push("};");
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileIfChanged(targetPath, `${lines.join("\n")}\n`);
}

export function writeGeneratedFiles(opts: {
  configDir: string;
  sources: ContractSource[];
  pluginKeys: string[];
  authSource: ContractSource | null;
  authExportPath?: string | null;
  apiDependsOn?: string[];
  pluginDependsOn?: Record<string, string[]>;
  pluginLocalPaths?: Record<string, string>;
  authLocalPath?: string;
  authDependsOn?: string[];
}) {
  const hasLocalApiWorkspace = existsSync(join(opts.configDir, "api", "src"));
  const baseSource = opts.sources.find((source) => source.key === "api");
  const pluginSources = opts.pluginKeys
    .map((key) => opts.sources.find((entry) => entry.key === key))
    .filter((source): source is ContractSource => Boolean(source));

  if (!baseSource) {
    throw new Error("API contract source is required to generate the aggregate contract");
  }

  // --- Generate ui/src/lib/api-types.gen.ts ---
  const uiContractPath = join(opts.configDir, "ui", "src", "lib", "api-types.gen.ts");
  const uiLines: string[] = [];

  for (const source of opts.sources) {
    const importPath = toImportPath(uiContractPath, source.sourceFilePath);
    uiLines.push(`import type { ContractType as ${source.importName} } from "${importPath}";`);
  }

  uiLines.push("");

  const compositeParts: string[] = [];
  if (opts.authSource) {
    compositeParts.push(`auth: ${opts.authSource.importName}`);
  }
  for (const source of pluginSources) {
    const key = /^[$A-Z_][0-9A-Z_$]*$/i.test(source.key) ? source.key : JSON.stringify(source.key);
    compositeParts.push(`${key}: ${source.importName}`);
  }

  if (compositeParts.length === 0) {
    uiLines.push(`export type ApiContract = ${baseSource.importName};`);
  } else {
    uiLines.push(`export type ApiContract = ${baseSource.importName} & {`);
    for (const part of compositeParts) {
      uiLines.push(`  ${part};`);
    }
    uiLines.push("};");
  }
  mkdirSync(dirname(uiContractPath), { recursive: true });
  writeFileIfChanged(uiContractPath, `${uiLines.join("\n")}\n`);

  // --- Generate api/src/lib/plugins-types.gen.ts ---
  // Filtered by apiDependsOn when explicit; includes all plugins + auth when implicit
  if (hasLocalApiWorkspace) {
    const pluginsClientPath = join(opts.configDir, "api", "src", "lib", "plugins-types.gen.ts");
    const pluginsClientLines: string[] = [];

    const allPluginSources = [...pluginSources];
    if (opts.authSource) {
      allPluginSources.push({ ...opts.authSource, key: "auth" });
    }

    const apiDepSources = opts.apiDependsOn?.length
      ? allPluginSources.filter((s) => opts.apiDependsOn!.includes(s.key))
      : allPluginSources;

    const unresolvedDepKeys =
      opts.apiDependsOn?.filter((depKey) => !allPluginSources.some((s) => s.key === depKey)) ?? [];

    for (const source of apiDepSources) {
      const importPath = toImportPath(pluginsClientPath, source.sourceFilePath);
      pluginsClientLines.push(
        `import type { ContractType as ${source.importName} } from "${importPath}";`,
      );
    }

    pluginsClientLines.push(
      'import type { RouterContractClient, RouterContract } from "@orpc/contract";',
    );
    pluginsClientLines.push('import type { ContractedRouter } from "@orpc/server";');
    pluginsClientLines.push(
      "type PluginClientEntry<C extends RouterContract> = {\n  client: (context?: Record<string, unknown>) => RouterContractClient<C>;\n  router: ContractedRouter<C, any>;\n};",
    );
    pluginsClientLines.push("");

    if (apiDepSources.length === 0 && unresolvedDepKeys.length === 0) {
      pluginsClientLines.push("export type PluginsClient = Record<string, never>;");
    } else {
      pluginsClientLines.push("export type PluginsClient = {");
      for (const source of apiDepSources) {
        const key = /^[$A-Z_][0-9A-Z_$]*$/i.test(source.key)
          ? source.key
          : JSON.stringify(source.key);
        pluginsClientLines.push(`  ${key}: PluginClientEntry<${source.importName}>;`);
      }
      for (const key of unresolvedDepKeys) {
        const keyStr = /^[$A-Z_][0-9A-Z_$]*$/i.test(key) ? key : JSON.stringify(key);
        pluginsClientLines.push(`  ${keyStr}?: PluginClientEntry<RouterContract>;`);
      }
      pluginsClientLines.push("};");
    }

    mkdirSync(dirname(pluginsClientPath), { recursive: true });
    writeFileIfChanged(pluginsClientPath, `${pluginsClientLines.join("\n")}\n`);
  }

  // --- Generate per-plugin plugins-client.gen.ts ---
  const allSourcesForLookup = [...pluginSources];
  if (opts.authSource) {
    allSourcesForLookup.push({ ...opts.authSource, key: "auth" });
  }

  for (const pluginKey of opts.pluginKeys) {
    const localPath = opts.pluginLocalPaths?.[pluginKey];
    if (!localPath) continue;

    const deps = opts.pluginDependsOn?.[pluginKey] ?? [];
    const depSources = deps
      .map((depKey) => allSourcesForLookup.find((s) => s.key === depKey))
      .filter((s): s is ContractSource => Boolean(s));

    writePluginClientGen({
      configDir: opts.configDir,
      pluginKey,
      depSources,
      localPath,
    });
  }

  if (opts.authLocalPath) {
    const deps = opts.authDependsOn ?? [];
    const depSources = deps
      .map((depKey) => allSourcesForLookup.find((s) => s.key === depKey))
      .filter((s): s is ContractSource => Boolean(s));

    writePluginClientGen({
      configDir: opts.configDir,
      pluginKey: "auth",
      depSources,
      localPath: opts.authLocalPath,
    });
  }

  // --- Generate */src/lib/auth-types.gen.ts ---
  const authTypeTargets = [join(opts.configDir, "ui", "src", "lib", "auth-types.gen.ts")];
  const apiLibDir = join(opts.configDir, "api", "src", "lib");
  if (existsSync(apiLibDir)) {
    authTypeTargets.push(join(apiLibDir, "auth-types.gen.ts"));
  }
  const hostLibDir = join(opts.configDir, "host", "src", "lib");
  if (existsSync(join(opts.configDir, "host", "src"))) {
    authTypeTargets.push(join(hostLibDir, "auth-types.gen.ts"));
  }

  // Per-plugin auth-types.gen.ts
  for (const key of opts.pluginKeys) {
    const localPath = opts.pluginLocalPaths?.[key];
    if (!localPath) continue;
    const pluginSrcDir = join(localPath, "src");
    if (existsSync(pluginSrcDir)) {
      authTypeTargets.push(join(pluginSrcDir, "lib", "auth-types.gen.ts"));
    }
  }

  if (opts.authExportPath) {
    for (const authTypesPath of authTypeTargets) {
      const exportImportPath = toImportPath(authTypesPath, opts.authExportPath);
      const contractImportPath = toImportPath(
        authTypesPath,
        join(dirname(opts.authExportPath), "contract.d.ts"),
      );
      mkdirSync(dirname(authTypesPath), { recursive: true });
      writeFileIfChanged(
        authTypesPath,
        buildAuthTypesGenContent(exportImportPath, contractImportPath),
      );
    }
  } else if (opts.authSource) {
    const generatedAuthExportPath = join(
      opts.configDir,
      ".bos",
      "generated",
      "auth",
      "auth-export.d.ts",
    );
    mkdirSync(dirname(generatedAuthExportPath), { recursive: true });
    if (!existsSync(generatedAuthExportPath)) {
      writeFileIfChanged(generatedAuthExportPath, buildAuthExportStub());
    }

    for (const authTypesPath of authTypeTargets) {
      const exportImportPath = toImportPath(authTypesPath, generatedAuthExportPath);
      const contractImportPath = toImportPath(
        authTypesPath,
        join(opts.configDir, ".bos", "generated", "auth", "contract.d.ts"),
      );
      mkdirSync(dirname(authTypesPath), { recursive: true });
      writeFileIfChanged(
        authTypesPath,
        buildAuthTypesGenContent(exportImportPath, contractImportPath),
      );
    }
  }

  return uiContractPath;
}

export interface ContractBridgeStatus {
  key: string;
  source: "local" | "remote" | "skipped" | "failed";
  url?: string;
  localPath?: string;
  error?: string;
}

export async function syncApiContractBridge(opts: {
  configDir: string;
  runtimeConfig: RuntimeConfig;
  apiBaseUrl: string;
}): Promise<{
  bridgePath: string;
  generatedPath: string | null;
  manifest: ApiPluginManifest | null;
  source: "local" | "remote";
  status: ContractBridgeStatus[];
}> {
  const runtimeDir = join(opts.configDir, ".bos", "generated");
  const isAuthMirrorEntry = (key: string, plugin: RuntimePluginConfig) =>
    isAuthMirrorPluginEntry(opts.runtimeConfig.auth, key, plugin);
  const pluginEntries = Object.entries(opts.runtimeConfig.plugins ?? {})
    .filter(([key, plugin]) => !isAuthMirrorEntry(key, plugin))
    .sort(([a], [b]) => a.localeCompare(b));
  const sources: ContractSource[] = [];
  const status: ContractBridgeStatus[] = [];
  let manifest: ApiPluginManifest | null = null;
  let generatedPath: string | null = null;
  let authSource: ContractSource | null = null;
  let authExportPath: string | null = null;
  const excludedPluginKeys = new Set<string>();

  try {
    const baseSource = await resolveContractSource({
      configDir: opts.configDir,
      runtimeDir,
      key: "api",
      source: opts.runtimeConfig.api,
      baseUrl: opts.apiBaseUrl,
      generatedSubdir: "api",
    });
    sources.push(baseSource);
    status.push({
      key: "api",
      source: opts.runtimeConfig.api.source,
      url: opts.runtimeConfig.api.source !== "local" ? opts.apiBaseUrl : undefined,
      localPath:
        opts.runtimeConfig.api.source === "local" ? opts.runtimeConfig.api.localPath : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[API Contract] Failed to resolve api contract: ${message}`);
    status.push({
      key: "api",
      source: "failed",
      url: opts.apiBaseUrl || undefined,
      error: message,
    });
  }

  if (opts.runtimeConfig.auth) {
    try {
      authSource = await resolveContractSource({
        configDir: opts.configDir,
        runtimeDir,
        key: "auth",
        source: opts.runtimeConfig.auth,
        baseUrl: opts.runtimeConfig.auth.url,
        generatedSubdir: "auth",
        localSourceFactory: localAuthContractSource,
      });
      sources.push(authSource);
      status.push({
        key: "auth",
        source: opts.runtimeConfig.auth.source,
        url: opts.runtimeConfig.auth.source !== "local" ? opts.runtimeConfig.auth.url : undefined,
        localPath:
          opts.runtimeConfig.auth.source === "local"
            ? opts.runtimeConfig.auth.localPath
            : undefined,
      });
      if (authSource.generatedPath) {
        generatedPath = authSource.generatedPath;
      }

      if (opts.runtimeConfig.auth.url && opts.runtimeConfig.auth.source !== "local") {
        try {
          const authManifest = await fetchApiPluginManifest(opts.runtimeConfig.auth.url);
          const fetchedAuthExportPath = await fetchAuthExportTypes({
            baseUrl: opts.runtimeConfig.auth.url,
            runtimeDir,
            manifest: authManifest,
          });
          if (fetchedAuthExportPath) {
            authExportPath = fetchedAuthExportPath;
          }
        } catch (error) {
          console.warn(
            `[API Contract] Failed to fetch auth additional exports: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (!authExportPath) {
        const localAuthExport = join(opts.configDir, "plugins", "auth", "src", "auth-export.ts");
        if (existsSync(localAuthExport)) {
          authExportPath = localAuthExport;
        } else {
          const generatedAuthExport = join(runtimeDir, "auth", "auth-export.d.ts");
          if (existsSync(generatedAuthExport)) {
            authExportPath = generatedAuthExport;
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[API Contract] Failed to resolve auth contract: ${message}`);
      status.push({
        key: "auth",
        source: "failed",
        url: opts.runtimeConfig.auth.url || undefined,
        error: message,
      });
    }
  }

  for (const [key, plugin] of pluginEntries) {
    if (!plugin.url && !plugin.localPath) {
      console.warn(
        `[API Contract] Skipping plugin "${key}" — no URL resolved (local path missing and no production URL configured)`,
      );
      status.push({ key, source: "skipped" });
      excludedPluginKeys.add(key);
    }
  }

  const resolvablePlugins = pluginEntries.filter(([key]) => !excludedPluginKeys.has(key));

  const pluginResults = await Promise.allSettled(
    resolvablePlugins.map(async ([key, plugin]) => {
      const source = await resolveContractSource({
        configDir: opts.configDir,
        runtimeDir,
        key,
        source: plugin,
        baseUrl: plugin.url,
        generatedSubdir: `plugins/${key}`,
      });
      return {
        key,
        source,
        plugin,
      };
    }),
  );

  pluginResults.forEach((result, index) => {
    const [key, plugin] = resolvablePlugins[index]!;
    if (result.status === "fulfilled") {
      sources.push(result.value.source);
      status.push({
        key,
        source: plugin.source,
        url: plugin.source !== "local" ? plugin.url : undefined,
        localPath: plugin.source === "local" ? plugin.localPath : undefined,
      });
      if (result.value.source.generatedPath) {
        generatedPath = result.value.source.generatedPath;
      }
    } else {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`[API Contract] Failed to resolve plugin "${key}": ${message}`);
      status.push({ key, source: "failed", url: plugin.url || undefined, error: message });
      excludedPluginKeys.add(key);
    }
  });

  const apiStatus = status.find((s) => s.key === "api");
  if (apiStatus?.source === "failed") {
    throw new Error(
      `Cannot generate contract types without api contract: ${apiStatus.error ?? "unknown error"}`,
    );
  }

  const allPluginKeys = pluginEntries
    .filter(([key]) => !excludedPluginKeys.has(key))
    .map(([key]) => key);

  const pluginDependsOn: Record<string, string[]> = {};
  const pluginLocalPaths: Record<string, string> = {};
  for (const [key, plugin] of pluginEntries) {
    if (excludedPluginKeys.has(key)) continue;
    if (plugin.dependsOn?.length) {
      pluginDependsOn[key] = plugin.dependsOn;
    }
    if (plugin.localPath) {
      pluginLocalPaths[key] = plugin.localPath;
    }
  }

  writeGeneratedFiles({
    configDir: opts.configDir,
    sources,
    pluginKeys: allPluginKeys,
    authSource,
    authExportPath,
    apiDependsOn: opts.runtimeConfig.api.dependsOn,
    pluginDependsOn,
    pluginLocalPaths,
    authLocalPath:
      opts.runtimeConfig.auth?.source === "local" ? opts.runtimeConfig.auth.localPath : undefined,
    authDependsOn: opts.runtimeConfig.auth?.dependsOn,
  });

  if (opts.runtimeConfig.api.source !== "local") {
    manifest = await fetchApiPluginManifest(opts.apiBaseUrl);
  }

  return {
    bridgePath: join(opts.configDir, "ui", "src", "lib", "api-types.gen.ts"),
    generatedPath,
    manifest,
    source: opts.runtimeConfig.api.source,
    status,
  };
}
