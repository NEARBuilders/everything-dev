/**
 * Re-export shim — the manifest generator lives in
 * `every-plugin/ui/manifest/generator` (ADR 0008). Consumed via the
 * stable `everything-dev/ui/manifest-generator` specifier.
 *
 * Sections:
 *  - manifest generator — the UI manifest generation entry point
 */

export type { ManifestGeneratorOptions } from "every-plugin/ui/manifest-generator";
// manifest generator
export { generateUiManifest } from "every-plugin/ui/manifest-generator";
