import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  type WorkspaceVersionManifest,
  WorkspaceVersionManifestSchema,
} from "every-plugin/version-manifest";
import { bundleUrlToStagedPath, resolveContained } from "./bundle-path";

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
  /** Full per-file digest map of the dist (object path → SRI), when the
   * pinned manifest carries one — the diff base for skip-unchanged uploads. */
  files?: Record<string, string>;
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

function slotVersionFromManifest(
  base: string,
  manifest: WorkspaceVersionManifest,
): ResolvedSlotVersion {
  const trimmedBase = base.replace(/\/$/, "");
  return {
    entryUrl: `${trimmedBase}/${manifest.entry}`,
    entryIntegrity: manifest.entryIntegrity,
    ...(manifest.browserManifest
      ? { browserManifestUrl: `${trimmedBase}/${manifest.browserManifest.file}` }
      : {}),
    ...(manifest.ssr
      ? {
          ssrEntryUrl: `${trimmedBase}/${manifest.ssr.entry}`,
          ssrIntegrity: manifest.ssr.integrity,
        }
      : {}),
    ...(manifest.files ? { files: manifest.files } : {}),
  };
}

/**
 * Staged-slot preference (ADR 0020/0021 self-contained tier): when a runtime
 * stages its own namespace under `BOS_BUNDLE_DIR`, a slot resolves from the
 * staged dist's own version manifest instead of the config's pin — pinned
 * manifest bytes that predate the image (deploy lag after a release bump)
 * cannot exist in the staged namespace, so their hashed files would 404 the
 * disk and fall through to the network, where the stale immutable bytes
 * still answer 200 and boot a foreign build. The staged manifest is trusted
 * (staged by the image build itself) and skipped entirely when the slot is
 * absent from the staged namespace or the pinned manifest is present (the
 * normal healthy case, which keeps the pin's SRI check).
 */
function readStagedSlotVersion(base: string, pin: SlotPin): ResolvedSlotVersion | null {
  const bundleDir = process.env.BOS_BUNDLE_DIR;
  if (!bundleDir) return null;

  const slotDir = bundleUrlToStagedPath(base, bundleDir);
  if (!slotDir || !existsSync(slotDir)) return null;

  const pinnedManifestPath = resolveContained(slotDir, pin.manifest);
  if (!pinnedManifestPath || existsSync(pinnedManifestPath)) return null;

  const versionsDir = path.join(slotDir, "versions");
  if (!existsSync(versionsDir)) return null;
  const manifests = readdirSync(versionsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(versionsDir, name))
    .filter((file) => statSync(file).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs || (a < b ? -1 : 1));
  if (manifests.length === 0) return null;
  const manifestPath = manifests[0];
  if (!manifestPath) return null;

  try {
    const manifest = WorkspaceVersionManifestSchema.parse(
      JSON.parse(readFileSync(manifestPath, "utf8")),
    );
    return slotVersionFromManifest(base, manifest);
  } catch {
    return null;
  }
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

  const staged = readStagedSlotVersion(input.base, input.pin);
  if (staged) {
    cache.set(key, staged);
    return staged;
  }

  const manifestUrl = `${input.base.replace(/\/$/, "")}/${input.pin.manifest.replace(/^\//, "")}`;
  const body = await fetchText(manifestUrl, input.fetchImpl ?? fetch);
  const computed = `sha384-${createHash("sha384").update(body).digest("base64")}`;
  if (computed !== input.pin.integrity) {
    throw new Error(
      `[SRI] version manifest integrity mismatch for ${manifestUrl}\n  Expected: ${input.pin.integrity}\n  Computed: ${computed}`,
    );
  }
  const manifest: WorkspaceVersionManifest = WorkspaceVersionManifestSchema.parse(JSON.parse(body));

  const resolved = slotVersionFromManifest(input.base, manifest);
  cache.set(key, resolved);
  return resolved;
}
