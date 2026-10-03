import type { ClientRuntimeConfig } from "./config";

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
