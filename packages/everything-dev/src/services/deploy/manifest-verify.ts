import { createHash } from "node:crypto";

/**
 * The ONE manifest SRI-verify implementation (ticket #422): fetch a pinned
 * version manifest's bytes, compute the sha384 SRI, and compare against the
 * pin. Both rollback verification (atomic-deploys 11) and version-manifest
 * slot resolution (atomic-deploys 04) build on this — previously two (three
 * counting the publish pin check, which is rollback verification) copies.
 */

export interface ManifestPin {
  /** versioned manifest filename, relative to the slot's production base */
  manifest: string;
  /** the manifest document's own SRI */
  integrity: string;
}

export type VerifiedManifest = { ok: true; text: string } | { ok: false; reason: string };

export function manifestDocumentUrl(base: string, manifest: string): string {
  return `${base.replace(/\/$/, "")}/${manifest.replace(/^\//, "")}`;
}

export function computeManifestSri(text: string): string {
  return `sha384-${createHash("sha384").update(text).digest("base64")}`;
}

/** Fetch the pinned manifest and verify its SRI — never throws; callers map
 * the failure reason to their own result shapes (a slot check, a thrown
 * resolution error, …). */
export async function fetchVerifiedManifest(input: {
  base: string;
  pin: ManifestPin;
  fetchImpl?: typeof fetch;
}): Promise<VerifiedManifest> {
  const manifestUrl = manifestDocumentUrl(input.base, input.pin.manifest);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(manifestUrl);
  } catch (error) {
    return {
      ok: false,
      reason: `manifest fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, reason: `manifest fetch failed: ${response.status}` };
  }
  const text = await response.text();
  const computed = computeManifestSri(text);
  if (computed !== input.pin.integrity) {
    return {
      ok: false,
      reason: `integrity mismatch for ${manifestUrl} (expected ${input.pin.integrity}, computed ${computed})`,
    };
  }
  return { ok: true, text };
}
