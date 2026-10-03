import "@orpc/openapi/extensions/route";

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
  PluginClientType,
  PluginConfigInput,
  PluginContext,
  PluginContract,
  PluginInstance,
  PluginMetadata,
  PluginRegistry,
  PluginRouterType,
  PluginRuntimeConfig,
  PluginSecrets,
  PluginServicesEntry,
  PluginVariables,
  RegisteredPlugins,
  SecretsConfig,
  UsePluginResult,
} from "./types";
