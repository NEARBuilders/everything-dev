/**
 * Files retired by the v1 → v2 upgrade (ADR 0023). Single source of truth
 * for both the audit manifest's `deleteFiles` inventory (manifest.ts) and
 * the apply train's deletion pass (apply-manifest.ts).
 *
 * Deletion semantics differ by class:
 * - OBSOLETE_FILES: deleted unconditionally when present — nothing in the
 *   v2 surface reads them.
 * - RETIRED_STUB_FILES: deleted only when their generated replacement
 *   exists and no build config still references them — these are live
 *   build entries on v1.
 */

export const OBSOLETE_FILES = [
  "api/src/lib/plugins.ts",
  "ui/src/auth.ts",
  "ui/src/auth-types.gen.ts",
  "ui/src/lib/api-client.ts",
  "ui/src/lib/use-api-client.ts",
  "ui/src/lib/auth-utils.ts",
  "ui/src/api-contract.ts",
  "ui/src/api-contract.gen.ts",
  "ui/src/lib/auth-client.ts",
  "ui/src/lib/session.ts",
  "ui/scripts/generate-metadata.ts",
  "api/src/db/migrator.ts",
  "api/src/db/load-migrations.ts",
  "packages/everything-dev/cli.js",
  ".templatekeep",
  ".templatesync-exclude",
  // v1 hand-written UI shells superseded by the generated stubs (ADR 0023).
  // These are unreferenced by the v1 rsbuild config (its entries are
  // hydrate.tsx / router.server.tsx) and by no script — dead on the v1 tree.
  "ui/src/index.tsx",
  "ui/src/dev-entry.tsx",
  "ui/src/global.d.ts",
  "ui/src/globals.d.ts",
  "ui/src/vite-env.d.ts",
] as const;

/**
 * v1 hand-written entry shells that are LIVE build entries until
 * retire-v1-shell rewires the rsbuild config onto the generated stubs.
 * Map: retired file → generated replacement that must exist first.
 */
export const RETIRED_STUB_FILES: Readonly<Record<string, string>> = {
  "ui/src/hydrate.tsx": "ui/src/hydrate.gen.tsx",
  "ui/src/router.server.tsx": "ui/src/router.server.gen.tsx",
};
