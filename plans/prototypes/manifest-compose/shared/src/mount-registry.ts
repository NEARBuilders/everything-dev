/**
 * Mount registry v2 — gates only, shape-free (ADR 0008 §3).
 *
 * A mount is a gate + a host-owned pathless layout position. It carries NO
 * product semantics (no "dashboard", no shell, no chrome) — plugins bring
 * their own layouts and route freely inside their subtree, exactly like
 * standalone TanStack file-based routing.
 *
 * A plugin declares a mount by writing a ROOT-level pathless layout whose
 * last `_`-prefixed segment names the mount (`_public.tsx` → `public`).
 * The generator derives it; build validation checks it against this
 * registry. Gates are attached HOST-side at construction — a plugin cannot
 * ship a route that escapes its mount's gate, because plugins never
 * construct route objects.
 *
 * No mount name nests inside another — the v1 gate-aware collision machinery
 * (resolveCoreMount) has nothing to resolve in this vocabulary.
 *
 * The platform vocabulary also reserves _org / _team (parameterized
 * membership gates, ADR 0008 §3); the prototype exercises the three mounts
 * below and leaves those unimplemented.
 */

export interface MountDef {
  /** Human label for diagnostics only — never semantics. */
  label: string;
  /**
   * Gate id, executed host-side at construction. `null` = no gate.
   * Parameterized mounts own a URL segment and resolve their entity.
   */
  gate: "none" | "session" | "admin";
}

export const MOUNT_REGISTRY = {
  public: { label: "public", gate: "none" },
  authenticated: { label: "authenticated", gate: "session" },
  admin: { label: "admin", gate: "admin" },
} satisfies Record<string, MountDef>;

export type MountId = keyof typeof MOUNT_REGISTRY & string;
export const MOUNTS = Object.keys(MOUNT_REGISTRY) as MountId[];

/** Bump when the registry shape changes — invalidates all compose digests. */
export const MOUNT_REGISTRY_VERSION = 3;

/** Migration aliases: legacy `_`-segment names → canonical mounts. */
export const MOUNT_ALIASES: Record<string, MountId> = {
  auth: "authenticated",
  authed: "authenticated",
  dashboard: "authenticated",
};

export function resolveMountSegment(segment: string): MountId | undefined {
  if (segment in MOUNT_REGISTRY) return segment as MountId;
  return MOUNT_ALIASES[segment];
}
