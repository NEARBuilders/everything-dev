import { Context, Data, Layer } from "effect";
import { fetchJsonOrNull, fetchRaw } from "../../utils/http-client";
import { keyPathOf, parseRuntimeRef, type RegistryKey } from "./keys";

/**
 * The registry transport — the one implementation of FastKV reads. Module is
 * the implementation, tag is the seam (#425's shape): plain functions for
 * direct callers, `RegistryClient` for Effect consumers. The WRITE side is a
 * signing concern (the signer services, #423) and lives elsewhere by design.
 *
 * Reads are action-indexed FastKV entries (namespace = the signing account);
 * on-chain execution of the write may fail without affecting the indexed
 * value — the read-back here is the authority, which is why `absent` and
 * `unreachable` are distinct errors and why nothing in this module swallows
 * them into null silently.
 */

export type NetworkId = "mainnet" | "testnet";

const FASTKV_TESTNET_URL = "https://kv.test.fastnear.com";
const FASTKV_MAINNET_URL = "https://kv.main.fastnear.com";
const REGISTRY_NAMESPACE_TESTNET = "dev.allthethings.testnet";
const REGISTRY_NAMESPACE_MAINNET = "dev.everything.near";

/** The network a signing account publishes on — the account suffix is the
 * network. One function; nothing else may derive a base URL. */
export function networkIdForAccount(accountId: string): NetworkId {
  return accountId.endsWith(".testnet") ? "testnet" : "mainnet";
}

export function registryBaseUrlForNetwork(network: NetworkId): string {
  return network === "testnet" ? FASTKV_TESTNET_URL : FASTKV_MAINNET_URL;
}

export function registryNamespaceForNetwork(network: NetworkId, registry?: string): string {
  if (registry) return registry;
  return network === "testnet" ? REGISTRY_NAMESPACE_TESTNET : REGISTRY_NAMESPACE_MAINNET;
}

export class RegistryError extends Data.TaggedError("RegistryError")<{
  readonly key: string;
  readonly kind: "absent" | "unreachable";
  readonly cause?: unknown;
}> {
  override get message(): string {
    return this.kind === "absent"
      ? `Not published in the registry: ${this.key}`
      : `Registry read failed: ${this.key}`;
  }
}

interface FastKvEntry {
  value?: unknown;
  key?: string;
  block_height?: number;
  block_timestamp?: string | number;
  tx_hash?: string;
}

interface FastKvListResponse {
  entries?: Array<FastKvEntry | null>;
  page_token?: string;
}

export interface RegistryEntry {
  key: string;
  value: unknown;
  blockHeight: number;
  blockTimestampNs: string;
  txHash?: string;
}

export interface RegistryHistoryEntry {
  blockHeight: number;
  blockTimestampNs: string;
  txHash?: string;
  value: unknown;
}

export interface RegistryListInput {
  /** Defaults to the namespace's whole latest-state listing. */
  ref?: RegistryKey["ref"];
  keyPrefix?: string;
  limit?: number;
  pageToken?: string;
  includeMetadata?: boolean;
}

export interface RegistryListResult {
  entries: RegistryEntry[];
  pageToken: string | null;
}

interface ReadOptions {
  /** A registry override — the namespace contract account. */
  registry?: string;
  /** Direct-read seam for tests. */
  fetchImpl?: typeof fetch;
}

const parseValue = (value: unknown, key: string): unknown => {
  if (typeof value === "string" && value.length > 0) {
    return JSON.parse(value) as unknown;
  }
  if (value === null || value === undefined || value === "") {
    throw new RegistryError({ key, kind: "absent" });
  }
  if (typeof value !== "object") {
    throw new RegistryError({ key, kind: "unreachable", cause: `Invalid value for ${key}` });
  }
  return value;
};

const toEntry = (entry: FastKvEntry): RegistryEntry => ({
  key: entry.key ?? "",
  value: entry.value,
  blockHeight: entry.block_height ?? 0,
  blockTimestampNs: String(entry.block_timestamp ?? ""),
  ...(entry.tx_hash ? { txHash: entry.tx_hash } : {}),
});

const parseJsonish = (value: unknown): unknown =>
  typeof value === "string" && value.length > 0 ? (JSON.parse(value) as unknown) : value;

const HISTORY_MAX_LIMIT = 200;
const HISTORY_DEFAULT_LIMIT = 20;

function buildUrl(key: RegistryKey, surface: "latest" | "history", opts?: ReadOptions): string {
  const { accountId } = parseRuntimeRef(key.ref);
  const network = networkIdForAccount(accountId);
  const namespace = registryNamespaceForNetwork(network, opts?.registry);
  const encodedKey = encodeURIComponent(keyPathOf(key));
  const base = registryBaseUrlForNetwork(network);
  return `${base}/v0/${surface}/${encodeURIComponent(namespace)}/${encodeURIComponent(accountId)}/${encodedKey}`;
}

async function readLatest<T>(key: RegistryKey, opts?: ReadOptions): Promise<T> {
  const wire = keyPathOf(key);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    const response = opts?.fetchImpl
      ? await opts.fetchImpl(buildUrl(key, "latest", opts), { headers })
      : await fetchRaw(buildUrl(key, "latest", opts), { headers });
    if (!response.ok) {
      if (response.status === 404) {
        throw new RegistryError({ key: wire, kind: "absent" });
      }
      throw new RegistryError({
        key: wire,
        kind: "unreachable",
        cause: `HTTP ${response.status}`,
      });
    }
    const payload = (await response.json()) as FastKvListResponse | null;
    const value = payload?.entries?.find(Boolean)?.value;
    if (value === undefined || value === null || value === "") {
      throw new RegistryError({ key: wire, kind: "absent" });
    }
    return parseValue(value, wire) as T;
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    throw new RegistryError({ key: wire, kind: "unreachable", cause: error });
  }
}

async function listLatest(
  input: RegistryListInput,
  opts?: ReadOptions,
): Promise<RegistryListResult> {
  const ref = input.ref;
  const accountId = ref ? parseRuntimeRef(ref).accountId : REGISTRY_NAMESPACE_MAINNET;
  const network = networkIdForAccount(accountId);
  const namespace = registryNamespaceForNetwork(network, opts?.registry);
  const base = registryBaseUrlForNetwork(network);
  const path = ref
    ? `/v0/latest/${encodeURIComponent(namespace)}/${encodeURIComponent(accountId)}`
    : `/v0/latest/${encodeURIComponent(namespace)}`;
  const url = `${base}${path}`;
  const body = JSON.stringify({
    limit: input.limit ?? 50,
    ...(input.keyPrefix ? { key_prefix: input.keyPrefix } : {}),
    ...(input.pageToken ? { page_token: input.pageToken } : {}),
    ...(input.includeMetadata ? { include_metadata: true } : {}),
  });
  const payload = opts?.fetchImpl
    ? await (opts.fetchImpl(url, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body,
      }) as Promise<Response>)
    : await fetchRaw(url, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body,
      });
  if (!payload.ok) {
    throw new RegistryError({
      key: input.keyPrefix ?? namespace,
      kind: "unreachable",
      cause: `HTTP ${payload.status}`,
    });
  }
  const parsed = (await payload.json()) as FastKvListResponse | null;
  const entries = (parsed?.entries ?? [])
    .filter((entry): entry is FastKvEntry => entry !== null)
    .map(toEntry);
  return { entries, pageToken: parsed?.page_token ?? null };
}

async function readHistory(
  key: RegistryKey,
  limit?: number,
  opts?: ReadOptions,
): Promise<RegistryHistoryEntry[]> {
  const capped = Math.max(1, Math.min(limit ?? HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT));
  const url = `${buildUrl(key, "history", opts)}?limit=${capped}`;
  const payload = await fetchJsonOrNull<FastKvListResponse>(url, {
    headers: { accept: "application/json" },
    retries: 3,
  });
  const entries = (payload?.entries ?? []).filter((entry): entry is FastKvEntry => entry !== null);
  return entries
    .map((entry) => {
      const mapped = toEntry(entry);
      return {
        blockHeight: mapped.blockHeight,
        blockTimestampNs: mapped.blockTimestampNs,
        ...(mapped.txHash ? { txHash: mapped.txHash } : {}),
        value: parseJsonish(mapped.value),
      };
    })
    .sort((a, b) => b.blockHeight - a.blockHeight);
}

/** The canonical latest-state URL for a key — for display and external
 * links (the client owns all URL derivation; nothing else builds one). */
export function latestUrlFor(key: RegistryKey, opts?: { registry?: string }): string {
  return buildUrl(key, "latest", opts);
}

/** The plain-function seam — module is the implementation, tag is the seam. */
export const registryClientShape = {
  read: <T>(key: RegistryKey, opts?: ReadOptions): Promise<T> => readLatest<T>(key, opts),
  readOrNull: <T>(key: RegistryKey, opts?: ReadOptions): Promise<T | null> =>
    readLatest<T>(key, opts).catch((error: unknown) => {
      if (error instanceof RegistryError && error.kind === "absent") return null;
      throw error;
    }),
  list: (input: RegistryListInput, opts?: ReadOptions): Promise<RegistryListResult> =>
    listLatest(input, opts),
  history: (
    key: RegistryKey,
    limit?: number,
    opts?: ReadOptions,
  ): Promise<RegistryHistoryEntry[]> => readHistory(key, limit, opts),
};

export type RegistryClientShape = typeof registryClientShape;

export class RegistryClient extends Context.Service<RegistryClient, RegistryClientShape>()(
  "everything-dev/registry/client",
) {
  static readonly Live = Layer.succeed(this, this.of(registryClientShape));
}
