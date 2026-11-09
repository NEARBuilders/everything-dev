import { createHash } from "node:crypto";
import { asDigest, fetchVerified, isVerifyError } from "../verify/engine";

export interface ManifestPin {
  /** versioned manifest filename, relative to the remote's production base */
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

export function reasonOf(error: unknown): string {
  if (!isVerifyError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  if (error._tag === "IntegrityMismatch") {
    return `integrity mismatch for ${error.url} (expected ${error.expected}, computed ${error.actual})`;
  }
  if (error._tag === "ProvenanceUnknown") {
    if (error.status !== undefined) {
      return `manifest fetch failed: ${error.status}`;
    }
    return `manifest fetch failed: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`;
  }
  return `signature invalid for ${error.url}: ${error.reason}`;
}

export async function fetchVerifiedManifest(input: {
  base: string;
  digest: ManifestPin;
  fetchImpl?: typeof fetch;
}): Promise<VerifiedManifest> {
  const manifestUrl = manifestDocumentUrl(input.base, input.digest.manifest);
  try {
    const bytes = await fetchVerified({
      url: manifestUrl,
      expected: asDigest(input.digest.integrity),
      fetchImpl: input.fetchImpl,
      cache: false,
    });
    return { ok: true, text: new TextDecoder().decode(bytes) };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}
