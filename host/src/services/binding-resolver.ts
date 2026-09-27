import { logger } from "../utils/logger";
import { resolveDomain } from "../utils/normalize";
import type { RuntimeConfig } from "./config";

export type TenantBindingStatus = "active" | "pending" | "suspended" | "pending_deletion";

export interface TenantBinding {
  hostname: string;
  tenantId: string;
  accountId: string;
  allowUiOverrides: boolean;
  allowBackendOverrides: boolean;
  allowSsr: boolean;
  status: TenantBindingStatus;
}

const BINDINGS_TTL_MS = 30_000;
export const FAILURE_TTL_MS = 10_000;

interface CachedBindings {
  apiUrl: string;
  expiresAt: number;
  entries: Map<string, TenantBinding>;
  refetching?: Promise<Map<string, TenantBinding>>;
  failedUntil?: number;
}

let bindingsCache: CachedBindings | null = null;

export function clearBindingResolverCache() {
  bindingsCache = null;
}

function isBaseHost(hostname: string, gatewayId: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === gatewayId || normalized === "localhost" || normalized === "127.0.0.1";
}

const LOCALHOST_SUFFIX = ".localhost";

/**
 * Development affordance: bindings are keyed `<label>.<gatewayId>` and the
 * gateway id stays the production domain locally, so `<label>.localhost` would
 * never match a tenant. In development we map it back to its label so a
 * locally created tenant is reachable at `http://<label>.localhost:<port>`.
 * Returns null in production, for bare `localhost`, and for nested labels.
 */
function devLocalhostLabel(hostname: string): string | null {
  if (process.env.NODE_ENV === "production") return null;
  if (!hostname.endsWith(LOCALHOST_SUFFIX)) return null;
  const label = hostname.slice(0, -LOCALHOST_SUFFIX.length);
  if (!label || label.includes(".")) return null;
  return label;
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
    const hint =
      response.status === 503
        ? " — API plugin is not available on this host; tenant bindings cannot be resolved (see /api/_health)"
        : "";
    throw new Error(`GET ${endpoint} failed with HTTP ${response.status}${hint}`);
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
    const hostname = binding.hostname.toLowerCase();
    entries.set(hostname.includes(".") ? hostname : `${hostname}.${gatewayId}`, binding);
  }
  return entries;
}

function ensureBindingsLoaded(config: RuntimeConfig): Promise<Map<string, TenantBinding>> {
  const apiUrl = config.host.url;
  if (!apiUrl) {
    return Promise.resolve(new Map());
  }

  const now = Date.now();
  if (
    bindingsCache?.apiUrl === apiUrl &&
    bindingsCache.failedUntil &&
    bindingsCache.failedUntil > now
  ) {
    return Promise.reject(
      new Error(
        `Tenant bindings unavailable (cached failure, ${Math.ceil((bindingsCache.failedUntil - now) / 1000)}s remaining) — last fetch of ${apiUrl}/api/tenants/bindings failed`,
      ),
    );
  }

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
      logger.error(`[BindingResolver] ${cause instanceof Error ? cause.message : String(cause)}`);
      logger.error(
        "[BindingResolver] Tenant resolution is unavailable: the API plugin failed to load on this host, so /api/tenants/bindings cannot be served. Tenant-domain SSR and asset proxying will fail until the API loads. Check GET /api/_health and the startup plugin-load errors.",
      );
      bindingsCache = {
        apiUrl,
        expiresAt: now,
        entries: new Map(),
        failedUntil: Date.now() + FAILURE_TTL_MS,
      };
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
      const direct = entries.get(normalized);
      if (direct) return direct;

      const devLabel = devLocalhostLabel(normalized);
      return devLabel ? (entries.get(`${devLabel}.${gatewayId}`) ?? null) : null;
    },
    clear: clearBindingResolverCache,
  };
}
