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
