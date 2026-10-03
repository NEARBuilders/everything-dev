/**
 * Mount registry v2 — gates only, shape-free (ADR 0008 §3).
 *
 * A mount is a gate + a host-owned pathless layout position. It carries no
 * product semantics (no "dashboard", no shell, no chrome) — plugins bring
 * their own layouts and route freely inside their subtree. A mount is
 * declared by a ROOT-level pathless layout file whose `_`-prefixed segment
 * names the mount (`_public.tsx` → `public`); the generator derives it and
 * validates it against this registry; gates are attached HOST-side at
 * construction, so a plugin cannot ship a route that escapes its mount's
 * gate (plugins never construct route objects).
 *
 * `org`/`team` are declared vocabulary (parameterized membership gates) but
 * unimplemented — construction rejects them until they land.
 */

export interface MountDef {
  label: string;
  gate: "none" | "session" | "admin" | "organization" | "team";
  parameterized?: boolean;
  implemented: boolean;
}

export const MOUNT_REGISTRY = {
  public: { label: "public", gate: "none", implemented: true },
  authenticated: { label: "authenticated", gate: "session", implemented: true },
  admin: { label: "admin", gate: "admin", implemented: true },
  org: { label: "org", gate: "organization", parameterized: true, implemented: false },
  team: { label: "team", gate: "team", parameterized: true, implemented: false },
} satisfies Record<string, MountDef>;

export type MountId = keyof typeof MOUNT_REGISTRY & string;

export const MOUNTS = Object.keys(MOUNT_REGISTRY) as MountId[];

/** Bump when the registry shape changes — invalidates all compose digests. */
export const MOUNT_REGISTRY_VERSION = 4;

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
