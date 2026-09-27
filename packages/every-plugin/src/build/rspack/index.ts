export {
  getPluginSharedDependencies,
  isEffectCriticalSharedDep,
  type SharedDependencies,
  type SharedDependencyConfig,
} from "../shared-deps";
export {
  createPluginBaseConfig,
  EveryPluginComposedBuild,
  type EveryPluginComposedBuildOptions,
  type PluginBaseConfig,
  type PluginBaseConfigOptions,
} from "./compose";
export { FixMfDataUriPlugin } from "./fix-mf-data-uri-plugin";
export {
  type AdditionalExport,
  EmitPluginManifest,
  EveryPluginBuild,
  type EveryPluginBuildOptions,
  type PluginManifestEmitterOptions,
} from "./plugin";
