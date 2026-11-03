/**
 * The manifest cache — the stand-in layer, in one place. A cached resolution
 * stands in for a live fetch only while it is fresh (the #546 machinery):
 * pin-match required when the resolution is pinned, TTL-bounded always. The
 * cache exists for offline dev ONLY — never stale-pin grace: slot-first
 * resolution makes old pins resolvable forever from immutable slots, so a
 * cache can no longer be the reason a pin resolves. Without the freshness
 * bound a registry outage (or a cache written before the parent's latest
 * publish) silently serves a months-old release manifest — pins derive from
 * it and the mismatch can take an hour to diagnose. Past the TTL the cache
 * is refused: pin-less resolution degrades to "no manifest"; pinned
 * resolution fails loud with the slot key named.
 *
 * Storage: one record at `<configDir>/.bos/manifest.json`. The record's
 * wire shape (`kind`, fields) is unchanged from the pre-rename layout; the
 * old `platform-manifest.json` location is not read — the upgrade
 * migration phase deletes a stale one for cleanliness.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "../platform/manifest-schema";

export interface ManifestCacheRecord {
  schemaVersion: 1;
  kind: "everything-dev/platform-manifest-cache";
  resolvedAt: string;
  source: { account: string; gateway: string };
  manifest: Manifest;
  provenance?: "slot" | "pointer";
}

export const MANIFEST_CACHE_TTL_MS = 24 * 60 * 60_000;

export type ManifestCacheRead =
  | { state: "miss" }
  | { state: "stale"; record: ManifestCacheRecord }
  | { state: "hit"; record: ManifestCacheRecord };

export interface ReadManifestCacheOptions {
  configDir: string;
  /** When set, a fresh cache only hits if the record IS that release — the
   * pin-match half of the #546 predicate. */
  pin?: string;
  now?: () => number;
  ttlMs?: number;
  /** test seam — replaces the file read */
  read?: () => ManifestCacheRecord | null;
}

export interface WriteManifestCacheOptions {
  configDir: string;
  record: ManifestCacheRecord;
  /** test seam — replaces the file write */
  write?: (record: ManifestCacheRecord) => void;
}

function defaultCachePath(configDir: string): string {
  return join(configDir, ".bos", "manifest.json");
}

function defaultRead(configDir: string): ManifestCacheRecord | null {
  try {
    if (!existsSync(defaultCachePath(configDir))) return null;
    const raw = JSON.parse(
      readFileSync(defaultCachePath(configDir), "utf-8"),
    ) as ManifestCacheRecord;
    return raw?.kind === "everything-dev/platform-manifest-cache" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The freshness predicate: `resolvedAt` inside the TTL, parseable (a cache
 * with an unparseable timestamp is stale — never trusted), and pin-matched
 * when a pin is in force.
 */
export function readManifestCache(opts: ReadManifestCacheOptions): ManifestCacheRead {
  const record = opts.read ? opts.read() : defaultRead(opts.configDir);
  if (!record) return { state: "miss" };
  const now = (opts.now ?? Date.now)();
  const ttl = opts.ttlMs ?? MANIFEST_CACHE_TTL_MS;
  const resolvedAt = Date.parse(record.resolvedAt);
  if (Number.isNaN(resolvedAt) || now - resolvedAt > ttl) return { state: "stale", record };
  if (opts.pin !== undefined && record.manifest.frameworkVersion !== opts.pin) {
    return { state: "stale", record };
  }
  return { state: "hit", record };
}

export function writeManifestCache(opts: WriteManifestCacheOptions): void {
  try {
    if (opts.write) {
      opts.write(opts.record);
      return;
    }
    mkdirSync(join(opts.configDir, ".bos"), { recursive: true });
    writeFileSync(defaultCachePath(opts.configDir), `${JSON.stringify(opts.record, null, 2)}\n`);
  } catch {
    // cache writes never fail the resolution
  }
}
