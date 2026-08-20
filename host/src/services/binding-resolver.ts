import { logger } from "../utils/logger";
import { resolveDomain } from "../utils/normalize";
import type { RuntimeConfig } from "./config";

export type TenantBindingStatus = "active" | "pending" | "suspended" | "pending_deletion";

export interface TenantBinding {
  hostname: string;
  accountId: string;
  allowUiOverrides: boolean;
  allowBackendOverrides: boolean;
  allowSsr: boolean;
  status: TenantBindingStatus;
}

const BINDINGS_TTL_MS = 30_000;

interface CachedBindings {
  apiUrl: string;
  expiresAt: number;
  entries: Map<string, TenantBinding>;
  refetching?: Promise<Map<string, TenantBinding>>;
}

let bindingsCache: CachedBindings | null = null;

export function clearBindingResolverCache() {
  bindingsCache = null;
}

function isBaseHost(hostname: string, gatewayId: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === gatewayId || normalized === "localhost" || normalized === "127.0.0.1";
}

async function fetchBindingsFromApi(apiUrl: string): Promise<TenantBinding[]> {
  const endpoint = `${apiUrl.replace(/\/$/, "")}/api/tenants/bindings`;
  let response: Response;
  try {
    response = await fetch(endpoint);
  } catch (cause) {
    throw new Error(`Failed to reach API at ${endpoint}: ${String(cause)}`, { cause });
  }

  if (!response.ok) {
    throw new Error(`GET ${endpoint} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as TenantBinding[];
}

function resolveGatewayId(config: RuntimeConfig): string {
  return resolveDomain(config.domain, config.host.url).toLowerCase();
}

function mapBindingsByHostname(
  config: RuntimeConfig,
  bindings: TenantBinding[],
): Map<string, TenantBinding> {
  const gatewayId = resolveGatewayId(config);
  const entries = new Map<string, TenantBinding>();
  for (const binding of bindings) {
    entries.set(`${binding.hostname.toLowerCase()}.${gatewayId}`, binding);
  }
  return entries;
}

function ensureBindingsLoaded(config: RuntimeConfig): Promise<Map<string, TenantBinding>> {
  const apiUrl = config.api?.url;
  if (!apiUrl) {
    return Promise.resolve(new Map());
  }

  const now = Date.now();
  if (
    bindingsCache &&
    bindingsCache.apiUrl === apiUrl &&
    bindingsCache.expiresAt > now &&
    bindingsCache.entries.size > 0
  ) {
    return Promise.resolve(bindingsCache.entries);
  }

  if (bindingsCache?.apiUrl === apiUrl && bindingsCache.refetching) {
    return bindingsCache.refetching;
  }

  const staleEntries = bindingsCache?.apiUrl === apiUrl ? bindingsCache.entries : null;

  const fetchPromise = fetchBindingsFromApi(apiUrl)
    .then((bindings) => {
      const entries = mapBindingsByHostname(config, bindings);
      bindingsCache = { apiUrl, expiresAt: Date.now() + BINDINGS_TTL_MS, entries };
      return entries;
    })
    .catch((cause) => {
      if (staleEntries && staleEntries.size > 0) {
        logger.error(
          `[BindingResolver] Refresh failed, serving ${staleEntries.size} stale binding(s): ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        bindingsCache = {
          apiUrl,
          expiresAt: Date.now() + BINDINGS_TTL_MS,
          entries: staleEntries,
        };
        return staleEntries;
      }
      bindingsCache = null;
      throw cause;
    });

  bindingsCache = {
    apiUrl,
    expiresAt: now + BINDINGS_TTL_MS,
    entries: staleEntries ?? new Map(),
    refetching: fetchPromise,
  };

  return fetchPromise;
}

export interface BindingResolver {
  resolve(hostname: string): Promise<TenantBinding | null>;
  clear(): void;
}

export function createBindingResolver(config: RuntimeConfig): BindingResolver {
  return {
    async resolve(hostname: string): Promise<TenantBinding | null> {
      const normalized = hostname.toLowerCase();
      const gatewayId = resolveGatewayId(config);
      if (isBaseHost(normalized, gatewayId)) {
        return null;
      }

      const entries = await ensureBindingsLoaded(config);
      return entries.get(normalized) ?? null;
    },
    clear: clearBindingResolverCache,
  };
}
