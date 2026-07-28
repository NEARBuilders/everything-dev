import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fetchJsonOrNull, fetchResponse } from "./http-client";
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
  const url = getApiPluginManifestUrl(apiBaseUrl);
  const manifest = await fetchJsonOrNull<ApiPluginManifest>(url, { retries: 0 });
  if (!manifest) {
    throw new Error(`Failed to fetch API plugin manifest from ${url}`);
  }
  if (manifest.schemaVersion !== 1 || manifest.kind !== "every-plugin/manifest") {
    throw new Error("Unsupported API plugin manifest format");
  }

  return manifest;
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
  const manifest = await fetchApiPluginManifest(opts.baseUrl);
  if (!manifest.contract) {
    throw new Error(
      `Plugin manifest for ${manifest.plugin.name} does not advertise contract types`,
    );
  }

  const contractUrl = `${trimTrailingSlash(opts.baseUrl)}/${manifest.contract.types.path.replace(/^\.\//, "")}`;
  const contractResponse = await fetchResponse(contractUrl);
  if (!contractResponse.ok) {
    throw new Error(
      `Failed to fetch contract types from ${contractUrl}: ${contractResponse.status} ${contractResponse.statusText}`,
    );
  }

  const contractTypes = await contractResponse.text();
  if (manifest.contract.types.sha256 && manifest.contract.types.sha256 !== sha256(contractTypes)) {
    throw new Error("Fetched contract types failed checksum verification");
  }

  const generatedPath = join(opts.runtimeDir, opts.generatedSubdir, "contract.d.ts");
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileIfChanged(generatedPath, contractTypes);

  return {
    key: opts.name,
    importName: `${sanitizeIdentifier(opts.name)}Contract`,
    sourceFilePath: generatedPath,
    generatedPath,
  };
}

async function fetchAuthExportTypes(opts: {
  baseUrl: string;
  runtimeDir: string;
  manifest: ApiPluginManifest;
}): Promise<string | null> {
  if (!opts.manifest.additionalExports || opts.manifest.additionalExports.length === 0) {
    return null;
  }

  const authExportEntry = opts.manifest.additionalExports.find(
    (entry) => entry.path.includes("auth-export") || entry.path.endsWith("auth-export.d.ts"),
  );

  if (!authExportEntry) {
    return null;
  }

  const exportUrl = `${trimTrailingSlash(opts.baseUrl)}/${authExportEntry.path.replace(/^\.\//, "")}`;
  const response = await fetchResponse(exportUrl);
  if (!response.ok) {
    console.warn(
      `[API Contract] Failed to fetch auth export types from ${exportUrl}: ${response.status}`,
    );
    return null;
  }

  const content = await response.text();
  if (authExportEntry.sha256 && authExportEntry.sha256 !== sha256(content)) {
    console.warn(`[API Contract] Auth export types checksum mismatch for ${exportUrl}`);
    return null;
  }

  const generatedPath = join(opts.runtimeDir, "auth", "auth-export.d.ts");
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileIfChanged(generatedPath, content);

  return generatedPath;
}

function writeAuthTypesGen(targetPath: string, authExportPath: string) {
  const exportImportPath = toImportPath(targetPath, authExportPath);
  const content = [
    `export type {`,
    `  Auth,`,
    `  AuthOrganizationContext,`,
    `  AuthOrganization,`,
    `  AuthOrganizationSummary,`,
    `  AuthOrganizationMember,`,
    `  AuthApiKey,`,
    `  AuthInvitation,`,
    `  GetActiveMemberInput,`,
    `  GetOrganizationInput,`,
    `  ListMembersInput,`,
    `  ListInvitationsInput,`,
    `  ListApiKeysInput,`,
    `  AuthServices,`,
    `  createAuthInstance,`,
    `} from "${exportImportPath}";`,
    `import type { InferOutput, ContractType as AuthContract } from "${toImportPath(targetPath, join(dirname(authExportPath), "contract.d.ts"))}";`,
    `import type { Auth as BaseAuth } from "${exportImportPath}";`,
    "",
    'type RawAuthSession = InferOutput<"getSession">;',
    'type RawAuthRequestContext = InferOutput<"getContext">;',
    'type RawAuthActiveMember = InferOutput<"getActiveMember">;',
    "",
    'export type AuthSessionUser = NonNullable<RawAuthSession["user"]>;',
    'export type AuthSessionData = NonNullable<RawAuthSession["session"]>;',
    "export type AuthSession = {",
    "  user: AuthSessionUser | null;",
    "  session: AuthSessionData | null;",
    "};",
    "export type AuthRequestContext = RawAuthRequestContext;",
    "export type AuthPluginContext = Partial<AuthRequestContext> & {",
    "  reqHeaders?: Headers;",
    "  getRawBody?: () => Promise<string>;",
    "};",
    "export type AuthActiveMember = RawAuthActiveMember;",
    'export type AuthBaseSession = BaseAuth["$Infer"]["Session"];',
    "export type AuthContractType = AuthContract;",
    "",
  ].join("\n");
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileIfChanged(targetPath, content);
}

function writeContractBasedAuthTypesGen(targetPath: string, configDir: string) {
  const authExportRel = toImportPath(
    targetPath,
    join(configDir, ".bos", "generated", "auth", "auth-export.d.ts"),
  );
  const contractRel = toImportPath(
    targetPath,
    join(configDir, ".bos", "generated", "auth", "contract.d.ts"),
  );

  const content = [
    `export type {`,
    `  Auth,`,
    `  AuthOrganizationContext,`,
    `  AuthOrganization,`,
    `  AuthOrganizationSummary,`,
    `  AuthOrganizationMember,`,
    `  AuthApiKey,`,
    `  AuthInvitation,`,
    `  GetActiveMemberInput,`,
    `  GetOrganizationInput,`,
    `  ListMembersInput,`,
    `  ListInvitationsInput,`,
    `  ListApiKeysInput,`,
    `  AuthServices,`,
    `  createAuthInstance,`,
    `} from "${authExportRel}";`,
    `import type { InferOutput, ContractType as AuthContract } from "${contractRel}";`,
    `import type { Auth as BaseAuth } from "${authExportRel}";`,
    "",
    'type RawAuthSession = InferOutput<"getSession">;',
    'type RawAuthRequestContext = InferOutput<"getContext">;',
    'type RawAuthActiveMember = InferOutput<"getActiveMember">;',
    "",
    'export type AuthSessionUser = NonNullable<RawAuthSession["user"]>;',
    'export type AuthSessionData = NonNullable<RawAuthSession["session"]>;',
    "export type AuthSession = {",
    "  user: AuthSessionUser | null;",
    "  session: AuthSessionData | null;",
    "};",
    "export type AuthRequestContext = RawAuthRequestContext;",
    "export type AuthPluginContext = Partial<AuthRequestContext> & {",
    "  reqHeaders?: Headers;",
    "  getRawBody?: () => Promise<string>;",
    "};",
    "export type AuthActiveMember = RawAuthActiveMember;",
    'export type AuthBaseSession = BaseAuth["$Infer"]["Session"];',
    "export type AuthContractType = AuthContract;",
    "",
  ].join("\n");
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileIfChanged(targetPath, content);
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
}) {
  const pluginSrcDir = join(opts.configDir, "plugins", opts.pluginKey, "src");
  if (!existsSync(pluginSrcDir)) return;

  const targetPath = join(pluginSrcDir, "plugins-client.gen.ts");
  const lines: string[] = [];

  for (const source of opts.depSources) {
    const importPath = toImportPath(targetPath, source.sourceFilePath);
    lines.push(`import type { ContractType as ${source.importName} } from "${importPath}";`);
  }

  lines.push('import type { ContractRouterClient, AnyContractRouter } from "@orpc/contract";');
  lines.push(
    "type ClientFactory<C extends AnyContractRouter> = (context?: Record<string, unknown>) => ContractRouterClient<C>;",
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
      lines.push(`  ${key}: ClientFactory<${source.importName}>;`);
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

    for (const source of apiDepSources) {
      const importPath = toImportPath(pluginsClientPath, source.sourceFilePath);
      pluginsClientLines.push(
        `import type { ContractType as ${source.importName} } from "${importPath}";`,
      );
    }

    pluginsClientLines.push(
      'import type { ContractRouterClient, AnyContractRouter } from "@orpc/contract";',
    );
    pluginsClientLines.push(
      "type ClientFactory<C extends AnyContractRouter> = (context?: Record<string, unknown>) => ContractRouterClient<C>;",
    );
    pluginsClientLines.push("");

    if (apiDepSources.length === 0) {
      pluginsClientLines.push("export type PluginsClient = Record<string, never>;");
    } else {
      pluginsClientLines.push("export type PluginsClient = {");
      for (const source of apiDepSources) {
        const key = /^[$A-Z_][0-9A-Z_$]*$/i.test(source.key)
          ? source.key
          : JSON.stringify(source.key);
        pluginsClientLines.push(`  ${key}: ClientFactory<${source.importName}>;`);
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
    const deps = opts.pluginDependsOn?.[pluginKey];
    if (!deps?.length) continue;

    const depSources = deps
      .map((depKey) => allSourcesForLookup.find((s) => s.key === depKey))
      .filter((s): s is ContractSource => Boolean(s));

    writePluginClientGen({
      configDir: opts.configDir,
      pluginKey,
      depSources,
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
    const pluginLibDir = join(opts.configDir, "plugins", key, "src", "lib");
    if (existsSync(join(opts.configDir, "plugins", key, "src"))) {
      authTypeTargets.push(join(pluginLibDir, "auth-types.gen.ts"));
    }
  }

  if (opts.authExportPath) {
    for (const authTypesPath of authTypeTargets) {
      writeAuthTypesGen(authTypesPath, opts.authExportPath);
    }
  } else if (opts.authSource) {
    for (const authTypesPath of authTypeTargets) {
      writeContractBasedAuthTypesGen(authTypesPath, opts.configDir);
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
  const pluginEntries = Object.entries(opts.runtimeConfig.plugins ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
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
    const [key, plugin] = resolvablePlugins[index];
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
  for (const [key, plugin] of pluginEntries) {
    if (!excludedPluginKeys.has(key) && plugin.dependsOn?.length) {
      pluginDependsOn[key] = plugin.dependsOn;
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
