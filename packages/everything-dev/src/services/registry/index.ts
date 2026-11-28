/**
 * The registry primitive — the framework-package export surface
 * (`everything-dev/registry`). The host reads the registry to know what
 * plugins exist, so the primitive MUST stay a framework export; the registry
 * plugin (plugins/registry) is the typed consumer surface, never the
 * transport owner.
 *
 * Sections:
 *  - platform manifest schema — the release-manifest record (ADR 0034)
 *  - cache — the manifest read/write cache
 *  - client — the FastKV HTTP client shape
 *  - confirm — publish confirm-leg verification
 *  - deploy-record — deploy record lockfile schemas
 *  - keys — runtime refs + registry key paths
 *  - resolution — extends-chain walking + release resolution
 */

export type { Manifest, ManifestTag } from "../platform/manifest-schema";
// platform manifest schema
export {
  CUTOVER_RELEASE,
  digestOfManifest,
  ManifestSchema,
  ManifestTagSchema,
  manifestTagOf,
} from "../platform/manifest-schema";
export type {
  ManifestCacheRead,
  ManifestCacheRecord,
  ReadManifestCacheOptions,
  WriteManifestCacheOptions,
} from "./cache";
// cache
export {
  MANIFEST_CACHE_TTL_MS,
  readManifestCache,
  writeManifestCache,
} from "./cache";
export type {
  NetworkId,
  RegistryClientShape,
  RegistryEntry,
  RegistryHistoryEntry,
  RegistryListInput,
  RegistryListResult,
} from "./client";
// client
export {
  latestUrlFor,
  networkIdForAccount,
  RegistryClient,
  RegistryError,
  registryBaseUrlForNetwork,
  registryClientShape,
  registryNamespaceForNetwork,
} from "./client";
export type {
  ConfigConfirmLeg,
  ConfirmLeg,
  ConfirmLegKind,
  ConfirmOptions,
  ConfirmVerdict,
  TxStatus,
} from "./confirm";
// confirm
export { confirmPublish, describeConfirmTimeout, TX_UNKNOWN_GRACE_MS } from "./confirm";
export type { DeployRecord, DeployRecordLockfile, PlatformManifestPin } from "./deploy-record";
// deploy-record
export {
  DeployRecordLockfileSchema,
  DeployRecordSchema,
  deployRecordTsOf,
  PlatformManifestPinSchema,
} from "./deploy-record";
export type { RegistryKey, RuntimeRef, RuntimeRefParts } from "./keys";
// keys
export { keyPathOf, parseRuntimeRef, RegistryRefError, runtimeRefOf } from "./keys";
export type {
  DeadEndContext,
  ExtendsChainNode,
  ExtendsChainWalk,
  PlatformManifestCache,
  ResolutionContext,
  ResolutionOutcome,
  ResolutionQuery,
  ResolutionSeams,
  ResolvedPlatformManifest,
  ResolvePlatformManifestOptions,
  TagServes,
} from "./resolution";
// resolution
export {
  resolvePlatformManifest,
  resolveRelease,
  walkExtendsChain,
} from "./resolution";
