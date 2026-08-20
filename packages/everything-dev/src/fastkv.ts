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

export function getFastKvBaseUrlForNetwork(network: NetworkId): string {
  return network === "testnet"
    ? process.env.REGISTRY_FASTKV_TESTNET_URL || "https://kv.test.fastnear.com"
    : process.env.REGISTRY_FASTKV_MAINNET_URL || "https://kv.main.fastnear.com";
}

function getFastKvBaseUrlForAccount(accountId: string): string {
  return getNetworkIdForAccount(accountId) === "testnet"
    ? getFastKvBaseUrlForNetwork("testnet")
    : getFastKvBaseUrlForNetwork("mainnet");
}

export function buildRegistryConfigUrl(accountId: string, gatewayId: string): string {
  const baseUrl = getFastKvBaseUrlForAccount(accountId);
  const namespace = getRegistryNamespaceForAccount(accountId);
  const key = encodeURIComponent(getRegistryConfigKey(accountId, gatewayId));
  return `${baseUrl}/v0/latest/${encodeURIComponent(namespace)}/${encodeURIComponent(accountId)}/${key}`;
}

export function buildRegistryConfigUrlForNetwork(
  network: NetworkId,
  accountId: string,
  gatewayId: string,
): string {
  const baseUrl = getFastKvBaseUrlForNetwork(network);
  const namespace = getRegistryNamespaceForNetwork(network);
  const key = encodeURIComponent(getRegistryConfigKey(accountId, gatewayId));
  return `${baseUrl}/v0/latest/${encodeURIComponent(namespace)}/${encodeURIComponent(accountId)}/${key}`;
}

export function getRegistryNamespaceForAccount(accountId: string): string {
  return accountId.endsWith(".testnet")
    ? process.env.REGISTRY_FASTKV_TESTNET_NAMESPACE || "dev.everything.near"
    : process.env.REGISTRY_FASTKV_MAINNET_NAMESPACE || "dev.everything.near";
}

export function getRegistryNamespaceForNetwork(network: NetworkId): string {
  return network === "testnet"
    ? process.env.REGISTRY_FASTKV_TESTNET_NAMESPACE || "dev.everything.near"
    : process.env.REGISTRY_FASTKV_MAINNET_NAMESPACE || "dev.everything.near";
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

export async function fetchBosConfigFromFastKv<T>(bosUrl: string): Promise<T> {
  const { accountId, gatewayId, pathSegments } = parseBosUrl(bosUrl);
  const key = encodeURIComponent(getRegistryConfigKey(accountId, gatewayId, pathSegments));
  const payload = await fetchJson<FastKvListResponse>(
    `${getFastKvBaseUrlForAccount(accountId)}/v0/latest/${encodeURIComponent(getRegistryNamespaceForAccount(accountId))}/${encodeURIComponent(accountId)}/${key}`,
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
  return fetchJsonOrNull<PluginManifest>(`${baseUrl}/plugin.manifest.json`, { retries: 0 });
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
