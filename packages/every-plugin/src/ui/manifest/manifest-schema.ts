import { z } from "zod";
import { MOUNTS } from "./mount-registry";

/**
 * manifest.gen.json — pure data emitted by the generator from route files
 * only (ADR 0008 §2). Nothing here is hand-maintained; this schema is the
 * composition contract and the audit/marketplace surface. The host refuses
 * unknown `manifestVersion` majors.
 */

/**
 * The manifest contract major this code speaks. Emitted by the generator and
 * enforced at every load (the host parses through `parsePluginManifest`; the
 * client parse of the compose payload checks it — a skewed major degrades to
 * the core-only tree instead of silently mis-constructing).
 */
export const MANIFEST_VERSION = 2;
export const SUPPORTED_MANIFEST_VERSION = MANIFEST_VERSION;

export const RouteRecordSchema = z.object({
  /** Full route id, root-relative, no leading slash. e.g. "_public/login" */
  id: z.string(),
  /** Node kind — the @tanstack/virtual-file-routes vocabulary. */
  type: z.enum(["route", "layout", "index"]),
  /** URL path relative to the parent; absent for pathless layouts. */
  path: z.string().optional(),
  /** id of the parent record within the same plugin; absent = mount-level. */
  parentId: z.string().optional(),
  /** Set on ROOT-level pathless layouts: the mount this subtree declares. */
  mount: z.enum(MOUNTS as [string, ...string[]]).optional(),
  /** Route file relative to the routes directory (options source). */
  file: z.string().optional(),
});

export const PluginManifestSchema = z.object({
  /** Plugin key — derived from the workspace/config key by the emitter. */
  name: z.string(),
  /** Contract version — enforced by `parsePluginManifest` / the payload check. */
  manifestVersion: z.number().int(),
  /** Lifted from the plugin's `__root` route options, if any. */
  rootMeta: z
    .object({
      hasHead: z.boolean().optional(),
      hasStaticData: z.boolean().optional(),
    })
    .optional(),
  routes: z.array(RouteRecordSchema),
});

/**
 * The load-time contract check — one diagnostic for a manifest from a
 * different framework major. Every manifest load goes through this.
 */
export function parsePluginManifest(data: unknown): PluginManifest {
  const parsed = PluginManifestSchema.parse(data);
  if (parsed.manifestVersion !== SUPPORTED_MANIFEST_VERSION) {
    throw new Error(manifestVersionIssue(parsed.name, parsed.manifestVersion));
  }
  return parsed;
}

const manifestVersionIssue = (name: string, found: number): string =>
  `unsupported manifest version ${found} in "${name}" — this build speaks ${SUPPORTED_MANIFEST_VERSION}; regenerate manifest.gen.json with the installed framework`;

export const ManifestSchema = z.object({
  manifestVersion: z.number().int(),
  plugins: z.array(PluginManifestSchema),
});

export type RouteRecord = z.infer<typeof RouteRecordSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * The client compose payload — the runtime-config `ui.compose` block the
 * server embeds and the client reconstructs the tree from. Single home:
 * everything-dev's client-config schema, the hydrate client, and the host's
 * ui-compose all derive from this schema.
 */
export const ComposeRemoteSchema = z.object({
  key: z.string(),
  name: z.string(),
  entry: z.string(),
  /** the remote's (hashed) browser-manifest URL — preferred over deriving
   * one from `entry` by stripping the legacy fixed entry name */
  manifestUrl: z.string().optional(),
});

export const ComposePayloadSchema = z
  .object({
    digest: z.string(),
    remotes: z.array(ComposeRemoteSchema),
    manifests: z.array(PluginManifestSchema),
  })
  .superRefine((payload, ctx) => {
    for (const manifest of payload.manifests) {
      if (manifest.manifestVersion !== SUPPORTED_MANIFEST_VERSION) {
        ctx.addIssue({
          code: "custom",
          message: manifestVersionIssue(manifest.name, manifest.manifestVersion),
        });
      }
    }
  });

export type ComposeRemote = z.infer<typeof ComposeRemoteSchema>;
export type ComposePayload = z.infer<typeof ComposePayloadSchema>;
