/**
 * Re-export shim — the manifest engine lives in `every-plugin/ui/manifest`
 * (ADR 0008: generator + composition belong to the plugin lifecycle
 * package). This specifier is baked into generated routeConfig typeImports
 * and consumed by the host, ui, and tests, so it must keep resolving here.
 *
 * Sections:
 *  - every-plugin manifest engine — construction, digests, plugin manifests,
 *    mount registry (ADR 0008)
 *  - remote entry — the browser remote-entry URL helper
 */

export type {
  AppInput,
  ComposePayload,
  ComposeRemote,
  ConstructedTree,
  ConstructInput,
  ConstructPluginRef,
  KnownPlugins,
  MountDef,
  MountId,
  NavDeclaration,
  NavItem,
  NavManifest,
  PluginManifest,
  PluginRef,
  PluginRefInput,
  RemoteSource,
  ResolvedApp,
  ResolvedPlugin,
  RouteConfigModule,
  RouteConfigRef,
  RouteOptionsBundle,
  RouteRecord,
} from "every-plugin/ui/manifest";
// every-plugin manifest engine
export {
  App,
  CORE_UI_PLUGIN_KEY,
  ComposePayloadSchema,
  compareNavItems,
  constructTree,
  digestOf,
  isManifestDocumentUrl,
  MANIFEST_DOCUMENT_PATTERN,
  MANIFEST_FILENAME,
  MANIFEST_VERSION,
  ManifestSchema,
  MOUNT_ALIASES,
  MOUNT_REGISTRY,
  MOUNT_REGISTRY_VERSION,
  MOUNTS,
  manifestBaseOf,
  PLUGIN_UI_SHARED_EXPOSES,
  Plugin,
  PluginManifestSchema,
  parsePluginManifest,
  RouteRecordSchema,
  resolveApp,
  resolveMountSegment,
  SUPPORTED_MANIFEST_VERSION,
  sanitizeContainerName,
  UI_EXPOSES,
  UI_REMOTE_ENTRY_FILENAME,
  UI_REMOTE_SERVER_ENTRY_FILENAME,
} from "every-plugin/ui/manifest";
export type { EntryUrls, RemoteEntry } from "../remote-entry";
// remote entry
export { entryUrls } from "../remote-entry";
