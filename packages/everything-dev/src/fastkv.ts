export type NetworkId = "mainnet" | "testnet";

interface FastKvEntry {
  value: unknown;
}

interface FastKvListResponse {
  entries?: Array<FastKvEntry | null>;
}

import { fetchJsonOrNull } from "./http-client";

function getNetworkIdForAccount(accountId: string): NetworkId {
  return accountId.endsWith(".testnet") ? "testnet" : "mainnet";
}

const FASTKV_TESTNET_URL = "https://kv.test.fastnear.com";
const FASTKV_MAINNET_URL = "https://kv.main.fastnear.com";
const REGISTRY_NAMESPACE_TESTNET = "dev.allthethings.testnet";
const REGISTRY_NAMESPACE_MAINNET = "dev.everything.near";

export function getFastKvBaseUrlForNetwork(network: NetworkId): string {
  return network === "testnet" ? FASTKV_TESTNET_URL : FASTKV_MAINNET_URL;
}

function getFastKvBaseUrlForAccount(accountId: string): string {
  return getNetworkIdForAccount(accountId) === "testnet"
    ? getFastKvBaseUrlForNetwork("testnet")
    : getFastKvBaseUrlForNetwork("mainnet");
}

export function buildRegistryConfigUrl(
  accountId: string,
  gatewayId: string,
  registry?: string,
): string {
  const baseUrl = getFastKvBaseUrlForAccount(accountId);
  const namespace = getRegistryNamespaceForAccount(accountId, registry);
  const key = encodeURIComponent(getRegistryConfigKey(accountId, gatewayId));
  return `${baseUrl}/v0/latest/${encodeURIComponent(namespace)}/${encodeURIComponent(accountId)}/${key}`;
}

export function buildRegistryConfigUrlForNetwork(
  network: NetworkId,
  accountId: string,
  gatewayId: string,
  registry?: string,
): string {
  const baseUrl = getFastKvBaseUrlForNetwork(network);
  const namespace = getRegistryNamespaceForNetwork(network, registry);
  const key = encodeURIComponent(getRegistryConfigKey(accountId, gatewayId));
  return `${baseUrl}/v0/latest/${encodeURIComponent(namespace)}/${encodeURIComponent(accountId)}/${key}`;
}

export function getRegistryNamespaceForAccount(accountId: string, registry?: string): string {
  return registry ?? getRegistryNamespaceForNetwork(getNetworkIdForAccount(accountId));
}

export function getRegistryNamespaceForNetwork(network: NetworkId, registry?: string): string {
  if (registry) return registry;
  return network === "testnet" ? REGISTRY_NAMESPACE_TESTNET : REGISTRY_NAMESPACE_MAINNET;
}

function getRegistryConfigKey(
  accountId: string,
  gatewayId: string,
  pathSegments: string[] = [],
): string {
  const suffix =
    pathSegments.length > 0
      ? `/${pathSegments.map((segment) => encodeURIComponent(segment)).join("/")}`
      : "";
  return `apps/${accountId}/${gatewayId}${suffix}/bos.config.json`;
}

export function parseBosUrl(bosUrl: string): {
  accountId: string;
  gatewayId: string;
  pathSegments: string[];
} {
  const strippedUrl = bosUrl.split("#")[0]!;
  const match = strippedUrl.match(/^bos:\/\/([^/]+)\/(.+)$/);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid BOS URL: ${bosUrl}`);
  }

  const pathSegments = match[2]
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (pathSegments.length === 0) {
    throw new Error(`Invalid BOS URL: ${bosUrl}`);
  }

  const [gatewayId, ...pathSegmentsTail] = pathSegments;
  if (!gatewayId) {
    throw new Error(`Invalid BOS URL: ${bosUrl}`);
  }

  return {
    accountId: match[1],
    gatewayId,
    pathSegments: pathSegmentsTail,
  };
}

export async function fetchBosConfigFromFastKv<T>(bosUrl: string, registry?: string): Promise<T> {
  const { accountId, gatewayId, pathSegments } = parseBosUrl(bosUrl);
  const key = encodeURIComponent(getRegistryConfigKey(accountId, gatewayId, pathSegments));
  const payload = await fetchJson<FastKvListResponse>(
    `${getFastKvBaseUrlForAccount(accountId)}/v0/latest/${encodeURIComponent(getRegistryNamespaceForAccount(accountId, registry))}/${encodeURIComponent(accountId)}/${key}`,
  );
  const value = payload?.entries?.find(Boolean)?.value;

  if (!value) {
    throw new Error(`No config found for ${bosUrl}`);
  }

  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  if (typeof value !== "object") {
    throw new Error(`Invalid config value for ${bosUrl}`);
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
}): Promise<ConfigHistoryEntry[]> {
  const key = encodeURIComponent(getRegistryConfigKey(opts.accountId, opts.gatewayId));
  const limit = Math.max(1, Math.min(opts.limit ?? 20, FASTKV_HISTORY_MAX_LIMIT));
  const url = `${getFastKvBaseUrlForAccount(opts.accountId)}/v0/history/${encodeURIComponent(getRegistryNamespaceForAccount(opts.accountId, opts.registry))}/${encodeURIComponent(opts.accountId)}/${key}?limit=${limit}`;
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
 * `apps/<account>/<gateway>/manifests/<ts>.json` atomically with the pointer
 * swap — this lists that key family newest-first via the history-by-prefix
 * endpoint.
 */
export async function fetchDeployManifests(opts: {
  accountId: string;
  gatewayId: string;
  registry?: string;
  limit?: number;
}): Promise<DeployManifestEntry[]> {
  const keyPrefix = encodeURIComponent(
    `${getRegistryConfigKey(opts.accountId, opts.gatewayId).replace(/bos\.config\.json$/, "")}manifests/`,
  );
  const url = `${getFastKvBaseUrlForAccount(opts.accountId)}/v0/history/${encodeURIComponent(getRegistryNamespaceForAccount(opts.accountId, opts.registry))}/${encodeURIComponent(opts.accountId)}`;
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
