import { createHash } from "node:crypto";
import {
  type WorkspaceVersionManifest,
  WorkspaceVersionManifestSchema,
} from "every-plugin/version-manifest";

/**
 * Version-manifest slot resolution (atomic-deploys 04): a config slot's
 * `pin` ({ manifest, integrity }) resolves to the derived entry-level fields
 * every consumer needs. The cache is keyed by the full pin — the pinned
 * bytes are immutable, so a verified entry is cached for the process
 * lifetime and serves as last-known-good if the origin later fails; a fetch
 * or SRI failure with nothing cached propagates (a boot-time resolution
 * failure fails the deploy, which is the platform's rollback).
 */

export interface ResolvedSlotVersion {
  /** Absolute URL of the content-hashed container entry. */
  entryUrl: string;
  entryIntegrity: string;
  /** Absolute URL of the hashed browser manifest (mf-manifest), when present. */
  browserManifestUrl?: string;
  /** Absolute URL of the content-hashed SSR entry, when present. */
  ssrEntryUrl?: string;
  ssrIntegrity?: string;
}

export interface SlotPin {
  /** versioned manifest filename, relative to the slot's production base */
  manifest: string;
  /** the manifest document's own SRI */
  integrity: string;
}

const cache = new Map<string, ResolvedSlotVersion>();

export function clearSlotVersionCache(): void {
  cache.clear();
}

function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  return fetchImpl(url).then((response) => {
    if (!response.ok) throw new Error(`version manifest fetch failed: ${response.status}`);
    return response.text();
  });
}

export async function resolveSlotVersion(input: {
  base: string;
  pin: SlotPin;
  fetchImpl?: typeof fetch;
}): Promise<ResolvedSlotVersion> {
  const key = `${input.base}::${input.pin.manifest}::${input.pin.integrity}`;
  // content-addressed: a verified pin is cached for the process lifetime and
  // never refetched — the cache IS the last-known-good
  const cached = cache.get(key);
  if (cached) return cached;

  const manifestUrl = `${input.base.replace(/\/$/, "")}/${input.pin.manifest.replace(/^\//, "")}`;
  const body = await fetchText(manifestUrl, input.fetchImpl ?? fetch);
  const computed = `sha384-${createHash("sha384").update(body).digest("base64")}`;
  if (computed !== input.pin.integrity) {
    throw new Error(
      `[SRI] version manifest integrity mismatch for ${manifestUrl}\n  Expected: ${input.pin.integrity}\n  Computed: ${computed}`,
    );
  }
  const manifest: WorkspaceVersionManifest = WorkspaceVersionManifestSchema.parse(JSON.parse(body));

  const resolved: ResolvedSlotVersion = {
    entryUrl: `${input.base.replace(/\/$/, "")}/${manifest.entry}`,
    entryIntegrity: manifest.entryIntegrity,
    ...(manifest.browserManifest
      ? {
          browserManifestUrl: `${input.base.replace(/\/$/, "")}/${manifest.browserManifest.file}`,
        }
      : {}),
    ...(manifest.ssr
      ? {
          ssrEntryUrl: `${input.base.replace(/\/$/, "")}/${manifest.ssr.entry}`,
          ssrIntegrity: manifest.ssr.integrity,
        }
      : {}),
  };
  cache.set(key, resolved);
  return resolved;
}
