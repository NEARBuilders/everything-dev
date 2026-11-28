/**
 * Public config surface (ADR 0031 #425): the concern modules live in
 * `services/resolution/` — this barrel keeps the `./config` subpath and the
 * internal import surface stable.
 */
export {
  CircularExtendsError,
  ConfigLoadError,
  ConfigVersionManifestError,
  DevOverlayError,
  defaultConfigEnv,
  findConfigPath,
  isAppDescriptorPath,
  loadAppDescriptorConfig,
  localConfigEntryPath,
  MISSING_CONFIG_MESSAGE,
  readAuthoredConfigInput,
  readLocalAuthoredConfigInput,
  resetConfigPathCache,
  resolveConfigComposableEntries,
} from "./services/resolution/load";
export type { BosEnv } from "./services/resolution/merge";
export {
  mergeBosConfigWithExtends,
  resolveExtendsRef,
} from "./services/resolution/merge";

export {
  buildRuntimeConfig,
  buildRuntimeConfigEffect,
  buildRuntimePluginsForConfig,
  getHostDevelopmentPort,
  resolveLocalDevelopmentPath,
  resolveUiRuntimeName,
} from "./services/resolution/runtime";
export {
  getResolvedConfigPath,
  loadGeneratedResolvedConfig,
  readBosConfigForBuild,
  resolveBosConfigPath,
  writeResolvedConfig,
} from "./services/resolution/serialize";
export type { BosConfig, RuntimeConfig } from "./types";
export { BosConfigSchema } from "./types";
