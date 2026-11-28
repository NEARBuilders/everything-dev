/**
 * Public config surface (ADR 0031 #425): the concern modules live in
 * `services/resolution/` — this barrel keeps the `./config` subpath and the
 * internal import surface stable.
 */
// config loading — the authored-config loader chain
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
// extends merging — ordered merge + extends-ref resolution
export type { BosEnv } from "./services/resolution/merge";
export { mergeBosConfigWithExtends, resolveExtendsRef } from "./services/resolution/merge";

// runtime building — the resolved runtime for host + plugins
export {
  buildRuntimeConfig,
  buildRuntimeConfigEffect,
  buildRuntimePluginsForConfig,
  getHostDevelopmentPort,
  resolveLocalDevelopmentPath,
  resolveUiRuntimeName,
} from "./services/resolution/runtime";
// resolved-config serialization — the .bos resolved-config lifecycle
export {
  getResolvedConfigPath,
  loadGeneratedResolvedConfig,
  readBosConfigForBuild,
  resolveBosConfigPath,
  writeResolvedConfig,
} from "./services/resolution/serialize";
// shared config types
export type { BosConfig, RuntimeConfig } from "./types";
export { BosConfigSchema } from "./types";
