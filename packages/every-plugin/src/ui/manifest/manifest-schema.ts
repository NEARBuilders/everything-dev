import { z } from "zod";
import { MOUNTS } from "./mount-registry";

/**
 * manifest.gen.json — pure data emitted by the generator from route files
 * only (ADR 0008 §2). Nothing here is hand-maintained; this schema is the
 * composition contract and the audit/marketplace surface. The host refuses
 * unknown `manifestVersion` majors.
 */

export const RouteRecordSchema = z.object({
  /** Full route id, root-relative, no leading slash. e.g. "_public/login" */
  id: z.string(),
  /** URL path relative to the parent; absent for pathless layouts. */
  path: z.string().optional(),
  /** `true` when the record is a pathless/layout node (rendered as `<Outlet/>`). */
  isLayout: z.boolean().optional(),
  /** id of the parent record within the same plugin; absent = mount-level. */
  parentId: z.string().optional(),
  /** Set on ROOT-level pathless layouts: the mount this subtree declares. */
  mount: z.enum(MOUNTS as [string, ...string[]]).optional(),
  /** Route file relative to the routes directory (options source). */
  file: z.string().optional(),
  /** `true` for a directory/index route resolved to its parent path. */
  isIndex: z.boolean().optional(),
});

export const PluginManifestSchema = z.object({
  /** Plugin key — derived from the workspace/config key by the emitter. */
  name: z.string(),
  /** Contract version; the host refuses unknown majors. */
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
});

export const ComposePayloadSchema = z.object({
  digest: z.string(),
  remotes: z.array(ComposeRemoteSchema),
  manifests: z.array(PluginManifestSchema),
});

export type ComposeRemote = z.infer<typeof ComposeRemoteSchema>;
export type ComposePayload = z.infer<typeof ComposePayloadSchema>;
