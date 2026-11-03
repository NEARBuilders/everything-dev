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

export function platformPointerKeyOf(accountId: string, gatewayId: string): string {
  return `apps/${accountId}/${gatewayId}/platform.json`;
}

/** The pointer key relative to `apps/<account>/<gateway>/` — the form the
 * history endpoint's `keyPath` parameter takes. */
export const PLATFORM_POINTER_REL_KEY = "platform.json";

export function platformVersionSlotKeyOf(
  accountId: string,
  gatewayId: string,
  version: string,
): string {
  return `apps/${accountId}/${gatewayId}/platform-versions/${version}.json`;
}

/** The per-deploy audit record's key — the timestamp is munged into a
 * FastKV-safe path form. */
export function deployAuditKeyOf(
  accountId: string,
  gatewayId: string,
  publishedAt: string,
): string {
  return `apps/${accountId}/${gatewayId}/manifests/${publishedAt.replace(/[:.]/g, "-")}.json`;
}

/** The release classifier's pointer read: absent (null) means no release has
 * published; a read failure throws — an unknown state must never silently
 * classify a release as non-release. */
export function readPlatformPointer<T>(
  accountId: string,
  gatewayId: string,
  registry?: string,
): Promise<T | null> {
  return fetchRegistryKey<T>(
    accountId,
    gatewayId,
    platformPointerKeyOf(accountId, gatewayId),
    registry,
  );
}

/** The release leg's immutability check: the version slot must either be
 * absent or hold byte-identical content — a divergent republish is a burned
 * version. */
export function readPlatformVersionSlot<T>(
  accountId: string,
  gatewayId: string,
  version: string,
  registry?: string,
): Promise<T | null> {
  return fetchRegistryKey<T>(
    accountId,
    gatewayId,
    platformVersionSlotKeyOf(accountId, gatewayId, version),
    registry,
  );
}
