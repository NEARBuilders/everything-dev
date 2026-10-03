export {
  getPluginSharedDependencies,
  isEffectCriticalSharedDep,
  type SharedDependencies,
  type SharedDependencyConfig,
} from "../../shared-deps-spec";
export { BuildReportPlugin } from "./build-report-plugin";
export {
  createPluginBaseConfig,
  type PluginBaseConfig,
  type PluginBaseConfigOptions,
} from "./compose";
export { FixMfDataUriPlugin } from "./fix-mf-data-uri-plugin";
export {
  EmitPluginManifest,
  EveryPluginBuild,
  type EveryPluginBuildOptions,
  type PluginManifestEmitterOptions,
} from "./plugin";
