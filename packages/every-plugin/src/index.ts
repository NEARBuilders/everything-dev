import "@orpc/openapi/extensions/route";

export * from "./client";
export * from "./dev/host";
export * from "./effect-helpers";
export * from "./errors";
export * from "./plugin";
export * from "./runtime";

// Re-export the normalize helper for build configs
export { getNormalizedRemoteName } from "./runtime/services/normalize";

export type {
  AnyPlugin,
  EveryPlugin,
  InitializedPlugin,
  LoadedPlugin,
  ModuleClientEntry,
  ModuleEndpoint,
  ModuleSurface,
  ModuleTransport,
  PluginClientEntry,
  PluginClientType,
  PluginConfigInput,
  PluginContext,
  PluginContract,
  PluginEndpoint,
  PluginInstance,
  PluginMetadata,
  PluginRegistry,
  PluginRouterType,
  PluginRuntimeConfig,
  PluginSecrets,
  PluginServicesEntry,
  PluginSurface,
  PluginTransport,
  PluginVariables,
  RegisteredPlugins,
  SecretsConfig,
  UsePluginResult,
} from "./types";
