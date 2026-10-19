import type { ClientRuntimeConfig } from "./config";

interface CachedValue<T> {
  expiresAt: number;
  value: T;
}

/** Drop expired entries (call before reads or periodically). */
export function pruneExpiredEntries<T>(cache: Map<string, CachedValue<T>>, now: number): void {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

/** FIFO-evict the oldest entries beyond `maxSize`. The generic is the stored value type — callers pass `CachedValue<T>` maps or raw maps. */
export function enforceCacheLimit<T>(cache: Map<string, T>, maxSize: number): void {
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

/**
 * The client runtime payload cache (E7): one window of `buildClientConfigCached`
 * results, keyed by tenant/origin/auth/digest. Its lifecycle belongs to the
 * serving snapshot — the swap flips it with the compose cache so a new
 * generation never serves stale entries computed against old deployment URLs.
 */
export interface CachedClientConfig {
  expiresAt: number;
  value: ClientRuntimeConfig;
}

export interface ClientConfigCacheState {
  entries: Map<string, CachedClientConfig>;
}

export function createClientConfigCacheState(): ClientConfigCacheState {
  return { entries: new Map() };
}
