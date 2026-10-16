/**
 * Public config surface (ADR 0031 #425): the concern modules live in
 * `services/resolution/` — this barrel keeps the `./config` subpath and the
 * internal import surface stable.
 */
export {
  CircularExtendsError,
  ConfigExtendsError,
  ConfigLoadError,
  ConfigNotfoundError,
  ConfigVersionManifestError,
  DEV_OVERLAY_FILENAME,
  DevOverlayError,
  defaultConfigEnv,
  findConfigPath,
  getConfigBaseDir,
  isAppDescriptorPath,
  LOCAL_PREFIX,
  loadAppDescriptorConfig,
  localConfigEntryPath,
  MISSING_CONFIG_MESSAGE,
  parseAppDescriptorModule,
  parseDevOverlayModule,
  parseExtendsTarget,
  type ResolvedComposableReference,
  readAuthoredConfigInput,
  readLocalAuthoredConfigInput,
  resetConfigPathCache,
  resolveComposableReference,
  resolveConfigComposableEntries,
  runWithConfigWarningSink,
} from "./services/resolution/load";
export type { BosEnv } from "./services/resolution/merge";
export {
  BOS_CONFIG_ORDER,
  mergeBosConfigWithExtends,
  rebuildOrderedConfig,
  resolveExtendsRef,
} from "./services/resolution/merge";

export {
  type BuildRuntimeConfigOptions,
  buildRuntimeConfig,
  buildRuntimeConfigEffect,
  buildRuntimePluginsForConfig,
  getHostDevelopmentPort,
  isLocalDevelopmentTarget,
  parsePort,
  resolveDevelopmentHostUrl,
  resolveLocalDevelopmentPath,
  resolvePluginRuntimeName,
  resolveUiRuntimeName,
} from "./services/resolution/runtime";
export {
  getResolvedConfigPath,
  loadGeneratedResolvedConfig,
  readBosConfigForBuild,
  resolveBosConfigPath,
  writeResolvedConfig,
} from "./services/resolution/serialize";
export {
  isRuntimeOverrideAllowed,
  parseRuntimeOverrideTargets,
} from "./services/resolution/validate";
export type { BosConfig, RuntimeConfig } from "./types";
export { BosConfigSchema } from "./types";
