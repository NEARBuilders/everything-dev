/**
 * The registry primitive — the framework-package export surface
 * (`everything-dev/registry`). The host reads the registry to know what
 * plugins exist, so the primitive MUST stay a framework export; the registry
 * plugin (plugins/registry) is the typed consumer surface, never the
 * transport owner.
 */

export {
  type PlatformReleaseManifest,
  PlatformReleaseManifestSchema,
} from "../platform/manifest-schema";
export * from "./cache";
export * from "./client";
export * from "./confirm";
export * from "./keys";
export * from "./resolution";
