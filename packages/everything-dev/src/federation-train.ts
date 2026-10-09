import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The auth app-slot's local workspace, derived from the resolved config:
 * `app.auth.development: "local:<dir>"` → `<dir>`, null otherwise. Shared by
 * the container-build orchestrator's build and staging phases — deriving it
 * per-site duplicated the expression and scoped it away from callers.
 */
export function resolveAuthWorkspace(
  bosConfig: { app?: { auth?: { development?: unknown } } } | undefined | null,
): string | null {
  const development = bosConfig?.app?.auth?.development;
  return typeof development === "string" && development.startsWith("local:")
    ? development.slice("local:".length)
    : null;
}

export interface MfManifest {
  shared?: Array<{ name?: string; version?: string; requiredVersion?: string | null }>;
}

/** The `every-plugin` share version a built remote stamps in its mf-manifest. */
export function everyPluginStamp(manifest: MfManifest): string | null {
  const entry = manifest.shared?.find((dep) => dep.name === "every-plugin");
  return entry?.version ?? entry?.requiredVersion ?? null;
}

export type FederationTrainCheck =
  | { ok: true; stamp: string }
  | {
      ok: false;
      reason: "missing-manifest" | "no-stamp" | "mismatch";
      stamp: string | null;
    };

/**
 * A built remote must stamp the same `every-plugin` share version as the
 * framework package on this checkout — a stale train surfaces at boot as a
 * strict-singleton mismatch ("Version X from host … needs Y") and every
 * /api/* route 503s. `distDir` is the workspace's built dist root.
 */
export function checkFederationTrain(distDir: string, expectedTrain: string): FederationTrainCheck {
  const manifestPath = join(distDir, "mf-manifest.json");
  if (!existsSync(manifestPath)) {
    return { ok: false, reason: "missing-manifest", stamp: null };
  }
  let manifest: MfManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as MfManifest;
  } catch {
    return { ok: false, reason: "missing-manifest", stamp: null };
  }
  const stamp = everyPluginStamp(manifest);
  if (!stamp) return { ok: false, reason: "no-stamp", stamp: null };
  return stamp === expectedTrain ? { ok: true, stamp } : { ok: false, reason: "mismatch", stamp };
}
