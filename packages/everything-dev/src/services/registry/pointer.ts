/**
 * The release-pointer plane's pre-cutover wire (sprint registry-primitive,
 * ticket 05). The key model (keys.ts) speaks the post-cutover wire —
 * `manifest.json`, `versions/<v>.json`, `deploys/<ts>.json` — but the train
 * still writes and the rollback still reads the old keys. Until ticket 10's
 * cutover, THIS file is the only place the old wire keys are derived; every
 * consumer derives them through here so the flip is one file.
 *
 * TODO(cutover): delete the templates below and re-point the helpers onto
 * keyPathOf({ kind: "manifest" | "version" | "deployRecord", ... }).
 */
import { fetchRegistryKey } from "./fastkv";

/** The pointer key relative to `apps/<account>/<gateway>/` — the form
 * `fetchRegistryKey` takes (it wraps with the runtime prefix) and the form
 * the history endpoint's `keyPath` parameter takes. The full-key helpers
 * below are derived from these — one derivation per wire key, so ticket 10's
 * cutover flips this file and nothing else. */
export const MANIFEST_TAG_REL_KEY = "manifest.json";

export function getVersionRelKey(version: string): string {
  return `versions/${version}.json`;
}

export function getManifestKey(accountId: string, gatewayId: string): string {
  return `apps/${accountId}/${gatewayId}/${MANIFEST_TAG_REL_KEY}`;
}

export function getVersionKey(accountId: string, gatewayId: string, version: string): string {
  return `apps/${accountId}/${gatewayId}/${getVersionRelKey(version)}`;
}

/** The per-deploy audit record's key — the timestamp is munged into a
 * FastKV-safe path form. */
export function deployAuditKeyOf(
  accountId: string,
  gatewayId: string,
  publishedAt: string,
): string {
  return `apps/${accountId}/${gatewayId}/deploys/${publishedAt.replace(/[:.]/g, "-")}.json`;
}

/** The release classifier's pointer read: absent (null) means no release has
 * published; a read failure throws — an unknown state must never silently
 * classify a release as non-release. The keyPath is RELATIVE —
 * `fetchRegistryKey` wraps it with the runtime prefix (a full key here
 * double-prefixes the wire key and reads a key that can never exist). */
export function readManifestTag<T>(
  accountId: string,
  gatewayId: string,
  registry?: string,
): Promise<T | null> {
  return fetchRegistryKey<T>(accountId, gatewayId, MANIFEST_TAG_REL_KEY, registry);
}

/** The release leg's immutability check: the version record must either be
 * absent or hold byte-identical content — a divergent republish is a burned
 * version. */
export function readVersionRecord<T>(
  accountId: string,
  gatewayId: string,
  version: string,
  registry?: string,
): Promise<T | null> {
  return fetchRegistryKey<T>(accountId, gatewayId, getVersionRelKey(version), registry);
}
