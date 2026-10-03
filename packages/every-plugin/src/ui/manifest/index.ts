/**
 * Browser-safe composition surface — everything here loads in the web
 * bundle (hydrate) and the host server. The GENERATOR is deliberately NOT
 * re-exported here: it rides @tanstack/router-generator (node fs + babel)
 * and is consumed only by build tooling via `./ui/manifest-generator`.
 */

export {
  type ConstructedTree,
  type ConstructInput,
  type ConstructPluginRef,
  constructTree,
  type GateUser,
  type HostContext,
  type ResolvedPlugin,
} from "./construct";
export * from "./contract";
export {
  App,
  type AppInput,
  type CompositionDigestInput,
  digestOf,
  type KnownPlugins,
  Plugin,
  type PluginRef,
  type PluginRefInput,
  type RemoteSource,
  type ResolvedApp,
  resolveApp,
} from "./descriptor";
export {
  type ComposePayload,
  ComposePayloadSchema,
  type ComposeRemote,
  type Manifest,
  ManifestSchema,
  type PluginManifest,
  PluginManifestSchema,
  type RouteRecord,
  RouteRecordSchema,
} from "./manifest-schema";
export {
  MOUNT_ALIASES,
  MOUNT_REGISTRY,
  MOUNT_REGISTRY_VERSION,
  MOUNTS,
  type MountDef,
  type MountId,
  resolveMountSegment,
} from "./mount-registry";
export type { NavDeclaration, NavItem, NavManifest } from "./nav";
export { compareNavItems } from "./nav";
export type { RouteConfigModule, RouteConfigRef, RouteOptionsBundle } from "./route-config";
