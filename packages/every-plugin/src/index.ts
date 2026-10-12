import "@orpc/openapi/extensions/route";

export * from "./effect-helpers";
export * from "./client";
export * from "./errors";
export * from "./dev/host";
export * from "./plugin";
export * from "./runtime";

// Re-export the normalize helper for build configs
export { getNormalizedRemoteName } from "./runtime/services/normalize";

export type {
  AnyPlugin,
  EveryPlugin,
  ModuleClientEntry,
  ModuleEndpoint,
  ModuleSurface,
  ModuleTransport,
  InitializedPlugin,
  LoadedPlugin,
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
  PluginSurface,
  PluginSecrets,
  PluginServicesEntry,
  PluginTransport,
  PluginVariables,
  RegisteredPlugins,
  SecretsConfig,
  UsePluginResult,
} from "./types";
