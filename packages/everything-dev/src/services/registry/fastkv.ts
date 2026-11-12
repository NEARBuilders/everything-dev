import { Context, Layer } from "effect";

export type NetworkId = "mainnet" | "testnet";

interface FastKvEntry {
  value: unknown;
}

interface FastKvListResponse {
  entries?: Array<FastKvEntry | null>;
}

import { fetchJsonOrNull, fetchRaw } from "../../utils/http-client";
import {
  latestUrlFor,
  networkIdForAccount,
  RegistryError,
  registryBaseUrlForNetwork,
  registryClientShape,
  registryNamespaceForNetwork,
} from "./client";
import { keyPathOf, parseRuntimeRef, type RegistryKey, type RuntimeRef } from "./keys";

export function getFastKvBaseUrlForNetwork(network: NetworkId): string {
  return registryBaseUrlForNetwork(network);
}

export function buildRegistryConfigUrl(
  accountId: string,
  gatewayId: string,
  registry?: string,
): string {
  return latestUrlFor(configKey(accountId, gatewayId), { registry });
}

export function buildRegistryConfigUrlForNetwork(
  network: NetworkId,
  accountId: string,
  gatewayId: string,
  registry?: string,
): string {
  const base = registryBaseUrlForNetwork(network);
  const namespace = registryNamespaceForNetwork(network, registry);
  const key = encodeURIComponent(keyPathOf(configKey(accountId, gatewayId)));
  return `${base}/v0/latest/${encodeURIComponent(namespace)}/${encodeURIComponent(accountId)}/${key}`;
}

export function getRegistryNamespaceForAccount(accountId: string, registry?: string): string {
  return registry ?? registryNamespaceForNetwork(networkIdForAccount(accountId));
}

export function getRegistryNamespaceForNetwork(network: NetworkId, registry?: string): string {
  return registryNamespaceForNetwork(network, registry);
}

function configKey(accountId: string, gatewayId: string, pathSegments: string[] = []): RegistryKey {
  return {
    kind: "runtimeConfig",
    ref: runtimeRefOf(accountId, gatewayId),
    ...(pathSegments.length > 0 ? { path: pathSegments } : {}),
  };
}

function getRegistryConfigKey(
  accountId: string,
  gatewayId: string,
  pathSegments: string[] = [],
): string {
  return keyPathOf(configKey(accountId, gatewayId, pathSegments));
}

function runtimeRefOf(accountId: string, gatewayId: string): RuntimeRef {
  return `bos://${accountId}/${gatewayId}`;
}

export async function fetchBosConfigFromFastKv<T>(bosUrl: string, registry?: string): Promise<T> {
  const { accountId, gatewayId, path } = parseRuntimeRef(bosUrl);
  try {
    return await registryClientShape.read<T>(
      configKey(accountId, gatewayId, path),
      registry !== undefined ? { registry } : undefined,
    );
  } catch (error) {
    // message parity: the historical failure surface is "No config found
    // for <bosUrl>" — keep it for absent reads so every "startsWith" check
    // downstream keeps working.
    if (error instanceof RegistryError && error.kind === "absent") {
      throw new Error(`No config found for ${bosUrl}`);
    }
    throw error;
  }
}

/**
 * Read an arbitrary registry key under `apps/<account>/<gateway>/` — the
 * well-known-key seam (the release manifest's thin tag at `manifest.json`
 * lives beside the config).
 * Absent key (404) → null; a network failure throws so callers can distinguish
 * "the key is empty" from "the key is unreachable" (a swallowed error here
 * would silently tighten a compat floor).
 */
export async function fetchRegistryKey<T>(
  accountId: string,
  gatewayId: string,
  keyPath: string,
  registry?: string,
): Promise<T | null> {
  const key = encodeURIComponent(`apps/${accountId}/${gatewayId}/${keyPath}`);
  const payload = await fetchJson<FastKvListResponse>(
    `${registryBaseUrlForNetwork(networkIdForAccount(accountId))}/v0/latest/${encodeURIComponent(getRegistryNamespaceForAccount(accountId, registry))}/${encodeURIComponent(accountId)}/${key}`,
  );
  const value = payload?.entries?.find(Boolean)?.value;
  if (!value) return null;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

/** Tolerant variant of {@link fetchRegistryKey} — any failure collapses to null. */
export async function fetchRegistryKeyOrNull<T>(
  accountId: string,
  gatewayId: string,
  keyPath: string,
  registry?: string,
): Promise<T | null> {
  try {
    return await fetchRegistryKey<T>(accountId, gatewayId, keyPath, registry);
  } catch {
    return null;
  }
}

/** Read a published config from an already-built registry URL
 * (`buildRegistryConfigUrlForNetwork`). Unlike {@link fetchBosConfigFromFastKv}
 * this takes the URL directly, so the read key is exactly the one the publish
 * writes, and a network failure is reported as such instead of collapsing
 * into "No config found" (fetchJsonOrNull swallows errors into null). */
export async function fetchPublishedConfigFromFastKv<T>(url: string): Promise<T> {
  const response = await fetchRaw(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`No config found for ${url}`);
    }
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  const payload = (await response.json()) as FastKvListResponse | null;
  return parseFastKvConfigValue<T>(payload, url);
}

export function parseFastKvConfigValue<T>(payload: FastKvListResponse | null, label: string): T {
  const value = payload?.entries?.find(Boolean)?.value;
  if (!value) {
    throw new Error(`No config found for ${label}`);
  }
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  if (typeof value !== "object") {
    throw new Error(`Invalid config value for ${label}`);
  }
  return value as T;
}

export interface ConfigHistoryEntry {
  blockHeight: number;
  blockTimestampNs: string;
  txHash?: string;
  value: unknown;
}

interface FastKvHistoryEntry {
  block_height?: number;
  block_timestamp?: string | number;
  tx_hash?: string;
  value?: unknown;
}

interface FastKvHistoryResponse {
  entries?: Array<FastKvHistoryEntry | null>;
}

const FASTKV_HISTORY_MAX_LIMIT = 200;

/**
 * Publish history for the registry config key (atomic-deploys 11): the
 * exact-key variant of FastData's history endpoint, newest-first. The API
 * caps a page at 200 rows; a config key's write history fits well inside
 * that, so a single request is the whole story (the limit param is clamped).
 */
export async function fetchConfigHistory(opts: {
  accountId: string;
  gatewayId: string;
  registry?: string;
  limit?: number;
  /** An exact key under `apps/<account>/<gateway>/` — defaults to the
   * registry config key. The platform pointer's history feeds the rollback
   * pointer restore (#573). */
  keyPath?: string;
}): Promise<ConfigHistoryEntry[]> {
  const key = encodeURIComponent(
    opts.keyPath ?? getRegistryConfigKey(opts.accountId, opts.gatewayId),
  );
  const limit = Math.max(1, Math.min(opts.limit ?? 20, FASTKV_HISTORY_MAX_LIMIT));
  const url = `${registryBaseUrlForNetwork(networkIdForAccount(opts.accountId))}/v0/history/${encodeURIComponent(getRegistryNamespaceForAccount(opts.accountId, opts.registry))}/${encodeURIComponent(opts.accountId)}/${key}?limit=${limit}`;
  const payload = await fetchJson<FastKvHistoryResponse>(url);
  const entries = (payload?.entries ?? []).filter(Boolean) as FastKvHistoryEntry[];

  return entries
    .map((entry) => ({
      blockHeight: entry.block_height ?? 0,
      blockTimestampNs: String(entry.block_timestamp ?? ""),
      ...(entry.tx_hash ? { txHash: entry.tx_hash } : {}),
      value:
        typeof entry.value === "string" && entry.value.length > 0
          ? (JSON.parse(entry.value) as unknown)
          : entry.value,
    }))
    .sort((a, b) => b.blockHeight - a.blockHeight);
}

export interface DeployManifestEntry {
  key: string;
  blockHeight: number;
  blockTimestampNs: string;
  value: unknown;
}

/**
 * The per-deploy audit trail (atomic-deploys 03/12): every publish writes
 * `apps/<account>/<gateway>/deploys/<ts>.json` atomically with the tag swap —
 * this lists that key family newest-first via the history-by-prefix endpoint.
 */
export async function fetchDeployManifests(opts: {
  accountId: string;
  gatewayId: string;
  registry?: string;
  limit?: number;
}): Promise<DeployManifestEntry[]> {
  const keyPrefix = encodeURIComponent(
    `${getRegistryConfigKey(opts.accountId, opts.gatewayId).replace(/bos\.config\.json$/, "")}deploys/`,
  );
  const url = `${registryBaseUrlForNetwork(networkIdForAccount(opts.accountId))}/v0/history/${encodeURIComponent(getRegistryNamespaceForAccount(opts.accountId, opts.registry))}/${encodeURIComponent(opts.accountId)}`;
  const payload = await fetchJson<FastKvHistoryResponse>(url, {
    method: "POST",
    body: JSON.stringify({
      key_prefix: decodeURIComponent(keyPrefix),
      asc: false,
      limit: Math.max(1, Math.min(opts.limit ?? 20, FASTKV_HISTORY_MAX_LIMIT)),
    }),
  });
  const entries = (payload?.entries ?? []).filter(Boolean) as Array<
    FastKvHistoryEntry & { key?: string }
  >;

  return entries
    .map((entry) => ({
      key: entry.key ?? "",
      blockHeight: entry.block_height ?? 0,
      blockTimestampNs: String(entry.block_timestamp ?? ""),
      value:
        typeof entry.value === "string" && entry.value.length > 0
          ? (JSON.parse(entry.value) as unknown)
          : entry.value,
    }))
    .sort((a, b) => b.blockHeight - a.blockHeight);
}

export interface PluginManifest {
  schemaVersion: number;
  kind: string;
  plugin: { name: string; version: string };
  runtime: { remoteEntry: string };
  contract: {
    kind: string;
    types: { path: string; exportName: string; typeName: string; sha256: string };
  };
  additionalExports?: Array<{ path: string; exports: string[]; sha256: string }>;
}

export async function fetchRemotePluginManifest(cdnUrl: string): Promise<PluginManifest | null> {
  const baseUrl = cdnUrl.replace(/\/$/, "");
  return fetchJsonOrNull<PluginManifest>(`${baseUrl}/plugin.manifest.json`, { retries: 2 });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetchJsonOrNull<T>(url, {
    method: init?.method,
    headers,
    body: init?.body ?? undefined,
    retries: 3,
  });
}

/**
 * The FastKV registry as a Context.Service (#425): reads (config, published
 * config, history, deploy manifests) and the bos:// URL algebra behind one
 * tag. The registry WRITE is a signing concern — it rides the signer
 * services (#423), not this tag. Callers may keep using the plain
 * functions — the module is the implementation; the tag is the seam.
 */
export class FastKVRegistryService extends Context.Service<
  FastKVRegistryService,
  {
    fetchBosConfigFromFastKv: typeof fetchBosConfigFromFastKv;
    fetchPublishedConfigFromFastKv: typeof fetchPublishedConfigFromFastKv;
    fetchConfigHistory: typeof fetchConfigHistory;
    fetchDeployManifests: typeof fetchDeployManifests;
  }
>()("everything-dev/registry/fastkv") {
  static readonly Live = Layer.succeed(
    this,
    this.of({
      fetchBosConfigFromFastKv,
      fetchPublishedConfigFromFastKv,
      fetchConfigHistory,
      fetchDeployManifests,
    }),
  );
}
