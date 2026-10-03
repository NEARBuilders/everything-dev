import { z } from "zod";
import { MOUNTS } from "./mount-registry";

/**
 * manifest.gen.json — pure data emitted by the generator from route files
 * only (ADR 0008 §2). Nothing here is hand-maintained; the schema is the
 * composition contract and the audit/marketplace surface.
 */

export const RouteRecordSchema = z.object({
  /** Full route id, root-relative, no leading slash. e.g. "_public/login" */
  id: z.string(),
  /** URL path relative to the parent, or `undefined` (JSON: absent) for pathless layouts. */
  path: z.string().optional(),
  /** `true` when the record is a pathless/layout node (rendered as <Outlet/> wrapper). */
  isLayout: z.boolean().optional(),
  /** id of the parent record within the same plugin; absent = parented by the host. */
  parentId: z.string().optional(),
  /** Set on ROOT-level pathless layouts: the mount this subtree declares. */
  mount: z.enum(MOUNTS as [string, ...string[]]).optional(),
  /** Route file relative to the plugin src dir (options source via route-config). */
  file: z.string().optional(),
  /** `true` for a directory/index route resolved to its parent path. */
  isIndex: z.boolean().optional(),
});

export const PluginManifestSchema = z.object({
  /** Plugin name — derived from the remote/workspace key by the emitter. */
  name: z.string(),
  /** `$schema`-style contract version; host refuses unknown majors. */
  manifestVersion: z.number().int(),
  /** Lifted from the plugin's `__root.tsx` route options, if any. */
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
