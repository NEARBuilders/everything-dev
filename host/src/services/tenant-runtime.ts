import { buildRuntimeConfig, loadRemoteConfig, type RuntimeConfig } from "everything-dev/config";
import { verifySriForUrl } from "everything-dev/integrity";
import type { RuntimePlugin } from "../types";
import { logger } from "../utils/logger";
import { resolveDomain } from "../utils/normalize";
import {
  type BindingResolver,
  clearBindingResolverCache,
  createBindingResolver,
} from "./binding-resolver";

const REMOTE_CONFIG_TTL_MS = 30_000;
const VERIFICATION_TTL_MS = 5 * 60_000;
const MAX_REMOTE_CONFIG_CACHE_SIZE = 256;
const MAX_VERIFICATION_CACHE_SIZE = 512;

type BosEnv = "development" | "production" | "staging";
type IntegrityVerificationMode = "blocking" | "stale-while-revalidate";

interface ResolveRequestRuntimeOptions {
  verification?: IntegrityVerificationMode;
  bindingResolver?: BindingResolver;
}

interface CachedRemoteConfig {
  expiresAt: number;
  value: Promise<Awaited<ReturnType<typeof loadRemoteConfig>>>;
}

interface CachedVerification {
  expiresAt: number;
  value: Promise<void>;
  refreshing?: Promise<void>;
}

export interface RequestRuntimeResolution {
  config: RuntimeConfig;
  tenantAccountId: string | null;
  gatewayId: string;
  ssrAllowed: boolean;
}

export class TenantRuntimeError extends Error {
  status: number;

  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TenantRuntimeError";
    this.status = status;
  }
}

const remoteConfigCache = new Map<string, CachedRemoteConfig>();
const verifiedUiCache = new Map<string, CachedVerification>();

function pruneExpiredCacheEntries<T extends { expiresAt: number }>(
  cache: Map<string, T>,
  now: number,
) {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function enforceCacheLimit<T>(cache: Map<string, T>, maxSize: number) {
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function getTenantRuntimeErrorStatus(error: unknown): number {
  if (error instanceof TenantRuntimeError) {
    return error.status;
  }

  return 500;
}

export function getTenantRuntimeErrorResponse(error: unknown): { status: number; message: string } {
  return {
    status: getTenantRuntimeErrorStatus(error),
    message: error instanceof Error ? error.message : String(error),
  };
}

export function clearTenantRuntimeCaches() {
  remoteConfigCache.clear();
  verifiedUiCache.clear();
  clearBindingResolverCache();
}

function getRemoteConfigCached(bosUrl: string, env: BosEnv) {
  const now = Date.now();
  pruneExpiredCacheEntries(remoteConfigCache, now);
  const cached = remoteConfigCache.get(bosUrl);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = loadRemoteConfig(bosUrl, env).catch((error) => {
    remoteConfigCache.delete(bosUrl);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(`No config found for ${bosUrl}`)) {
      throw new TenantRuntimeError(`No tenant config found for ${bosUrl}`, 404, { cause: error });
    }
    throw new TenantRuntimeError(`Failed to load tenant config for ${bosUrl}`, 502, {
      cause: error,
    });
  });
  remoteConfigCache.set(bosUrl, { value, expiresAt: now + REMOTE_CONFIG_TTL_MS });
  enforceCacheLimit(remoteConfigCache, MAX_REMOTE_CONFIG_CACHE_SIZE);
  return value;
}

function createIntegrityFailure(label: string, error: unknown) {
  return new TenantRuntimeError(`Integrity check failed for ${label}`, 502, { cause: error });
}

function createVerificationPromise(
  cacheKey: string,
  url: string,
  integrity: string,
  label: string,
) {
  const verification = verifySriForUrl(url, integrity).catch((error) => {
    const cached = verifiedUiCache.get(cacheKey);
    if (cached?.value === verification || cached?.refreshing === verification) {
      verifiedUiCache.delete(cacheKey);
    }
    throw createIntegrityFailure(label, error);
  });

  return verification;
}

function scheduleVerificationRefresh(
  cacheKey: string,
  cached: CachedVerification,
  url: string,
  integrity: string,
  label: string,
) {
  if (cached.refreshing) {
    return cached.refreshing;
  }

  const refresh = createVerificationPromise(cacheKey, url, integrity, label)
    .then(() => {
      const entry = verifiedUiCache.get(cacheKey);
      if (!entry || entry.refreshing !== refresh) {
        return;
      }

      entry.value = Promise.resolve();
      entry.expiresAt = Date.now() + VERIFICATION_TTL_MS;
      entry.refreshing = undefined;
    })
    .catch((error) => {
      logger.error(
        `[Tenant Runtime] Integrity refresh failed for ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    });

  cached.refreshing = refresh;
  return refresh;
}

async function verifyIntegrity(
  url: string,
  integrity: string,
  label: string,
  mode: IntegrityVerificationMode,
) {
  const cacheKey = `${url}::${integrity}`;
  const now = Date.now();
  const cached = verifiedUiCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (!cached) {
    const value = createVerificationPromise(cacheKey, url, integrity, label);
    verifiedUiCache.set(cacheKey, {
      value,
      expiresAt: now + VERIFICATION_TTL_MS,
    });
    enforceCacheLimit(verifiedUiCache, MAX_VERIFICATION_CACHE_SIZE);
    await value;

    const entry = verifiedUiCache.get(cacheKey);
    if (entry) {
      entry.value = Promise.resolve();
      entry.expiresAt = Date.now() + VERIFICATION_TTL_MS;
    }
    return;
  }

  if (mode === "stale-while-revalidate") {
    void scheduleVerificationRefresh(cacheKey, cached, url, integrity, label).catch(() => {});
    return cached.value;
  }

  const refresh = scheduleVerificationRefresh(cacheKey, cached, url, integrity, label);
  await refresh;

  const entry = verifiedUiCache.get(cacheKey);
  if (entry) {
    entry.value = Promise.resolve();
    entry.expiresAt = Date.now() + VERIFICATION_TTL_MS;
    entry.refreshing = undefined;
  }
}

async function verifyUiIntegrity(config: RuntimeConfig, mode: IntegrityVerificationMode) {
  if (!config.ui.url || !config.ui.integrity) {
    throw new TenantRuntimeError(
      "Tenant UI overrides must define app.ui.production and app.ui.integrity",
      404,
    );
  }

  await verifyIntegrity(config.ui.url, config.ui.integrity, `tenant UI ${config.ui.url}`, mode);
}

async function verifyPluginUiIntegrity(
  pluginKey: string,
  plugin: RuntimePlugin,
  mode: IntegrityVerificationMode,
) {
  if (!plugin.ui?.url) {
    throw new TenantRuntimeError(
      `Tenant plugin override for ${pluginKey} must define plugins.${pluginKey}.ui.production`,
      404,
    );
  }

  if (!plugin.ui.integrity) {
    throw new TenantRuntimeError(
      `Tenant plugin override for ${pluginKey} must define plugins.${pluginKey}.ui.integrity`,
      404,
    );
  }

  await verifyIntegrity(
    plugin.ui.url,
    plugin.ui.integrity,
    `tenant plugin UI ${pluginKey} ${plugin.ui.url}`,
    mode,
  );
}

function buildEffectivePluginConfig(
  basePlugin: RuntimePlugin,
  tenantPlugin: RuntimePlugin,
): RuntimePlugin {
  return {
    ...basePlugin,
    ...(tenantPlugin.ui ? { ui: tenantPlugin.ui } : {}),
    ...(tenantPlugin.connectSrc ? { connectSrc: tenantPlugin.connectSrc } : {}),
  };
}

function buildEffectiveRuntimeConfig(
  baseConfig: RuntimeConfig,
  tenantConfig: RuntimeConfig,
  tenantAccountId: string,
  allowUiOverrides: boolean,
  allowBackendOverrides: boolean,
): RuntimeConfig {
  const effectiveConfig: RuntimeConfig = {
    ...baseConfig,
    account: tenantAccountId,
    networkId: tenantConfig.networkId,
    title: tenantConfig.title,
    description: tenantConfig.description,
    repository: tenantConfig.repository,
  };

  if (allowUiOverrides) {
    effectiveConfig.ui = tenantConfig.ui;
  }

  const basePlugins = baseConfig.plugins ?? {};
  if (Object.keys(basePlugins).length > 0) {
    const effectivePlugins: NonNullable<RuntimeConfig["plugins"]> = { ...basePlugins };

    for (const [pluginKey, tenantPlugin] of Object.entries(tenantConfig.plugins ?? {})) {
      const basePlugin = basePlugins[pluginKey];
      if (!basePlugin) {
        continue;
      }

      if (!allowBackendOverrides) {
        continue;
      }

      effectivePlugins[pluginKey] = buildEffectivePluginConfig(basePlugin, tenantPlugin);
    }

    effectiveConfig.plugins = effectivePlugins;
  }

  return effectiveConfig;
}

export async function resolveRequestRuntime(
  baseConfig: RuntimeConfig,
  request: Request,
  options?: ResolveRequestRuntimeOptions,
): Promise<RequestRuntimeResolution> {
  const verificationMode = options?.verification ?? "blocking";
  const url = new URL(request.url);
  const gatewayId = resolveDomain(baseConfig.domain, baseConfig.host.url);
  const bindingResolver = options?.bindingResolver ?? createBindingResolver(baseConfig);
  const binding = await bindingResolver.resolve(url.hostname);
  if (!binding) {
    return {
      config: baseConfig,
      tenantAccountId: null,
      gatewayId,
      ssrAllowed: Boolean(baseConfig.ui.ssrUrl),
    };
  }

  const tenantAccountId = binding.accountId;
  if (binding.status === "suspended") {
    throw new TenantRuntimeError("Tenant is suspended", 503);
  }
  if (binding.status === "pending_deletion") {
    throw new TenantRuntimeError("Tenant has been deleted", 410);
  }

  const bosUrl = `bos://${tenantAccountId}/${gatewayId}`;
  const remoteConfig = await getRemoteConfigCached(bosUrl, "production");
  const baseBosUrl = `bos://${baseConfig.account}/${gatewayId}`;

  if (!remoteConfig.extendsChain.includes(baseBosUrl)) {
    throw new TenantRuntimeError(`Tenant config ${bosUrl} must extend ${baseBosUrl}`, 404);
  }

  if (remoteConfig.config.account !== tenantAccountId) {
    throw new TenantRuntimeError(
      `Tenant config ${bosUrl} resolved to account ${remoteConfig.config.account} instead of ${tenantAccountId}`,
      404,
    );
  }

  const tenantRuntimeConfig = await buildRuntimeConfig(
    remoteConfig.config,
    process.cwd(),
    "production",
    {
      hostSource: "remote",
      uiSource: "remote",
      apiSource: "remote",
      authSource: "remote",
    },
  );
  const effectiveConfig = buildEffectiveRuntimeConfig(
    baseConfig,
    tenantRuntimeConfig,
    tenantAccountId,
    binding.allowUiOverrides,
    binding.allowBackendOverrides,
  );

  if (effectiveConfig.ui.url !== baseConfig.ui.url) {
    await verifyUiIntegrity(effectiveConfig, verificationMode);
  }

  for (const [pluginKey, plugin] of Object.entries(effectiveConfig.plugins ?? {})) {
    const basePlugin = baseConfig.plugins?.[pluginKey];
    if (!basePlugin?.ui?.url || !plugin.ui?.url) {
      continue;
    }

    if (plugin.ui.url !== basePlugin.ui.url) {
      await verifyPluginUiIntegrity(pluginKey, plugin, verificationMode);
    }
  }

  const ssrAllowed =
    Boolean(effectiveConfig.ui.ssrUrl) &&
    Boolean(effectiveConfig.ui.ssrIntegrity) &&
    binding.allowSsr;

  return {
    config: ssrAllowed
      ? effectiveConfig
      : {
          ...effectiveConfig,
          ui: {
            ...effectiveConfig.ui,
            ssrUrl: undefined,
            ssrIntegrity: undefined,
          },
        },
    tenantAccountId,
    gatewayId,
    ssrAllowed,
  };
}
