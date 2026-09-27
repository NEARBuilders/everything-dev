import { isEffectCriticalSharedDep } from "../../build/shared-deps";

interface IdentityManifest {
  metaData?: { pluginVersion?: string };
  shared?: Array<{ name: string; version?: string }>;
}

export interface SharedIdentityMismatch {
  name: string;
  expected: string;
  actual: string | null;
}

const MANIFEST_TIMEOUT_MS = 15_000;

function manifestUrl(remoteUrl: string): string {
  return remoteUrl.endsWith("/") ? `${remoteUrl}mf-manifest.json` : `${remoteUrl}/mf-manifest.json`;
}

function normalizeBaseUrl(remoteUrl: string): string {
  const withoutHash = remoteUrl.split("#")[0] ?? remoteUrl;
  return withoutHash.replace(/\/(mf-manifest\.json|remoteEntry\.js)$/i, "");
}

export function compareSharedIdentity(
  remoteShared: Array<{ name: string; version?: string }> | undefined,
  expectedVersions: Map<string, string>,
): SharedIdentityMismatch[] {
  const mismatches: SharedIdentityMismatch[] = [];
  const remoteByName = new Map((remoteShared ?? []).map((s) => [s.name, s]));

  for (const [name, expected] of expectedVersions.entries()) {
    if (!isEffectCriticalSharedDep(name)) continue;
    const remoteEntry = remoteByName.get(name);
    if (!remoteEntry) continue;
    if (remoteEntry.version && remoteEntry.version !== expected) {
      mismatches.push({ name, expected, actual: remoteEntry.version });
    }
  }

  return mismatches;
}

export function describeSharedIdentityMismatch(
  pluginId: string,
  mismatches: SharedIdentityMismatch[],
  hostExpectation: string,
): string {
  const lines = mismatches.map(
    (m) =>
      `  ${m.name}: expected ${m.expected} (from ${hostExpectation}), got ${m.actual ?? "missing"}`,
  );
  return (
    `[SharedIdentity] Refusing to load plugin "${pluginId}": shared dependency version skew.\n` +
    `${lines.join("\n")}\n` +
    `Run "bos mf check" for the full report. Fix: rebuild and redeploy the host and this plugin together (single release train, e.g. "bos publish --deploy --packages local").`
  );
}

export async function fetchRemoteIdentityManifest(
  remoteUrl: string,
): Promise<IdentityManifest | null> {
  const base = normalizeBaseUrl(remoteUrl);
  const url = manifestUrl(base);
  const res = await fetch(url, { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS) });
  if (!res.ok) return null;
  return (await res.json()) as IdentityManifest;
}
