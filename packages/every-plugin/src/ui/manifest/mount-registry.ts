/**
 * Mount registry v2 — shape-free (ADR 0008 §3).
 *
 * A mount is a host-owned pathless layout position. It carries no product
 * semantics (no "dashboard", no shell, no chrome) — plugins bring their own
 * layouts and route freely inside their subtree. A mount is declared by a
 * ROOT-level pathless layout file whose `_`-prefixed segment names the mount
 * (`_public.tsx` → `public`); the generator derives it and validates it
 * against this registry; guards are ordinary beforeLoads attached HOST-side
 * at construction from ConstructInput.guards, so a plugin cannot ship a
 * route that escapes its mount's guard (plugins never construct route
 * objects).
 *
 * `org`/`team` are declared vocabulary (parameterized membership) but
 * unimplemented — construction rejects them until they land.
 */

export interface MountDef {
  /** The composing framework supplies this mount's guard via ConstructInput.guards. */
  guarded: boolean;
  implemented: boolean;
}

export const MOUNT_REGISTRY = {
  public: { guarded: false, implemented: true },
  authenticated: { guarded: true, implemented: true },
  admin: { guarded: true, implemented: true },
  org: { guarded: true, implemented: false },
  team: { guarded: true, implemented: false },
} as const satisfies Record<string, MountDef>;

export type MountId = Extract<keyof typeof MOUNT_REGISTRY, string>;

export const MOUNTS = Object.keys(MOUNT_REGISTRY) as MountId[];

/** Bump when the registry shape changes — invalidates all compose digests. */
export const MOUNT_REGISTRY_VERSION = 6;

/** Migration aliases: legacy `_`-segment names → canonical mounts. */
export const MOUNT_ALIASES: Record<string, MountId> = {
  auth: "authenticated",
  authed: "authenticated",
  dashboard: "authenticated",
  organization: "org",
};

export function resolveMountSegment(segment: string): MountId | undefined {
  if (segment in MOUNT_REGISTRY) return segment as MountId;
  return MOUNT_ALIASES[segment];
}
