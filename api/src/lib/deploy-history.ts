import { Context, Data, Effect, Layer } from "effect";
import { pointerFingerprint } from "everything-dev/fingerprint";
import { z } from "zod";

export const DeployAuditManifestSchema = z.object({
  account: z.string(),
  gateway: z.string(),
  network: z.string(),
  publishedAt: z.string(),
  registryUrl: z.string(),
  platformManifest: z
    .object({
      file: z.string(),
      integrity: z.string(),
    })
    .optional(),
});

export type DeployAuditManifest = z.infer<typeof DeployAuditManifestSchema>;

export const DeploySummarySchema = z.object({
  key: z.string(),
  publishedAt: z.string(),
  network: z.string().optional(),
  registryUrl: z.string().optional(),
  fingerprint: z.string().optional(),
  platformManifest: z
    .object({
      file: z.string(),
      integrity: z.string(),
    })
    .optional(),
  imageRef: z.string().optional(),
  rolledBackFrom: z.string().optional(),
  blockHeight: z.number().int(),
});

export type DeploySummary = z.infer<typeof DeploySummarySchema>;

export const ListDeploysInputSchema = z.object({
  account: z.string().min(1),
  gateway: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(20),
});

export type ListDeploysInput = z.infer<typeof ListDeploysInputSchema>;

export const ListDeploysOutputSchema = z.object({
  deploys: z.array(DeploySummarySchema),
});

export class DeployHistoryReadError extends Data.TaggedError("DeployHistoryReadError")<{
  message: string;
  cause?: unknown;
}> {}

export type NetworkId = "mainnet" | "testnet";

const FASTKV_TESTNET_URL = "https://kv.test.fastnear.com";
const FASTKV_MAINNET_URL = "https://kv.main.fastnear.com";
const REGISTRY_NAMESPACE_TESTNET = "dev.allthethings.testnet";
const REGISTRY_NAMESPACE_MAINNET = "dev.everything.near";
const FASTKV_HISTORY_MAX_LIMIT = 200;

export function networkIdForAccount(accountId: string): NetworkId {
  return accountId.endsWith(".testnet") ? "testnet" : "mainnet";
}

export function registryBaseUrlForAccount(accountId: string): string {
  return networkIdForAccount(accountId) === "testnet" ? FASTKV_TESTNET_URL : FASTKV_MAINNET_URL;
}

export function registryNamespaceForAccount(accountId: string, registry?: string): string {
  if (registry) return registry;
  return networkIdForAccount(accountId) === "testnet"
    ? REGISTRY_NAMESPACE_TESTNET
    : REGISTRY_NAMESPACE_MAINNET;
}

export function registryConfigKey(account: string, gateway: string): string {
  return `apps/${account}/${gateway}/bos.config.json`;
}

export function auditManifestKeyPrefix(account: string, gateway: string): string {
  return `apps/${account}/${gateway}/manifests/`;
}

export function platformManifestKey(account: string, gateway: string): string {
  return `apps/${account}/${gateway}/platform.json`;
}

export function auditManifestKey(account: string, gateway: string, publishedAt: string): string {
  return `${auditManifestKeyPrefix(account, gateway)}${publishedAt.replace(/[:.]/g, "-")}.json`;
}

export function historyUrlForPrefix(opts: {
  account: string;
  keyPrefix: string;
  limit: number;
  registry?: string;
}): string {
  const baseUrl = registryBaseUrlForAccount(opts.account);
  const namespace = registryNamespaceForAccount(opts.account, opts.registry);
  return `${baseUrl}/v0/history/${encodeURIComponent(namespace)}/${encodeURIComponent(opts.account)}`;
}

export function historyPrefixBody(opts: {
  keyPrefix: string;
  limit: number;
}): Record<string, unknown> {
  return { key_prefix: opts.keyPrefix, asc: false, limit: opts.limit };
}

export function historyUrlForKey(opts: {
  account: string;
  keyPath: string;
  limit: number;
  registry?: string;
}): string {
  const baseUrl = registryBaseUrlForAccount(opts.account);
  const namespace = registryNamespaceForAccount(opts.account, opts.registry);
  const key = encodeURIComponent(opts.keyPath);
  return `${baseUrl}/v0/history/${encodeURIComponent(namespace)}/${encodeURIComponent(opts.account)}/${key}?limit=${opts.limit}`;
}

export interface RegistryHistoryEntry {
  key?: string;
  blockHeight: number;
  blockTimestampNs: string | number;
  txHash?: string;
  value: unknown;
}

export function parseAuditManifest(value: unknown): DeployAuditManifest | null {
  if (typeof value === "string" && value.length > 0) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = DeployAuditManifestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rolledBackFromOf(configValue: unknown): string | undefined {
  const record = asRecord(configValue);
  return typeof record?.rolledBackFrom === "string" ? record.rolledBackFrom : undefined;
}

/** The pin in force at a deploy, from the joined platform.json release
 * manifest value (`image: { ref, tags }` → `ref@tag`); the registry digest
 * itself is never persisted (it is resolved per deploy from the tag). */
export function imageRefOfPlatformManifest(value: unknown): string | undefined {
  const record = asRecord(value);
  const image = asRecord(record?.image);
  if (typeof image?.ref !== "string" || image.ref.length === 0) return undefined;
  const tags = Array.isArray(image.tags) ? image.tags : [];
  const tag = tags.find((t): t is string => typeof t === "string");
  return tag ? `${image.ref}@${tag}` : image.ref;
}

/** Most-recent platform-manifest entry at or before the deploy's block — the
 * pin in force when that deploy published (the manifest only lands on the
 * deploys that write it, so later rows reuse the pin still active). */
export function platformPinAtBlock(
  platformEntries: RegistryHistoryEntry[],
  blockHeight: number,
): string | undefined {
  const candidates = platformEntries
    .filter((entry) => entry.blockHeight <= blockHeight)
    .sort((a, b) => b.blockHeight - a.blockHeight);
  for (const entry of candidates) {
    const ref = imageRefOfPlatformManifest(entry.value);
    if (ref) return ref;
  }
  return undefined;
}

export function assembleDeployRows(opts: {
  manifestEntries: RegistryHistoryEntry[];
  configEntries: RegistryHistoryEntry[];
  platformEntries?: RegistryHistoryEntry[];
}): DeploySummary[] {
  const configByBlock = new Map<number, unknown>();
  for (const entry of opts.configEntries) {
    if (!configByBlock.has(entry.blockHeight)) {
      configByBlock.set(entry.blockHeight, entry.value);
    }
  }
  const platformEntries = [...(opts.platformEntries ?? [])].sort(
    (a, b) => b.blockHeight - a.blockHeight,
  );

  const rows: DeploySummary[] = [];
  for (const entry of opts.manifestEntries) {
    const manifest = parseAuditManifest(entry.value);
    if (!manifest) continue;
    const joinedConfig = configByBlock.get(entry.blockHeight);
    const fingerprint = asRecord(joinedConfig)
      ? pointerFingerprint(joinedConfig as Parameters<typeof pointerFingerprint>[0])
      : undefined;
    rows.push({
      key: entry.key ?? auditManifestKey(manifest.account, manifest.gateway, manifest.publishedAt),
      publishedAt: manifest.publishedAt,
      network: manifest.network,
      registryUrl: manifest.registryUrl,
      fingerprint,
      platformManifest: manifest.platformManifest,
      imageRef: platformPinAtBlock(platformEntries, entry.blockHeight),
      rolledBackFrom: rolledBackFromOf(joinedConfig),
      blockHeight: entry.blockHeight,
    });
  }
  return rows;
}

export type HistoryFetch = (url: string, init?: RequestInit) => Promise<unknown>;

export async function fetchHistoryJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return (await response.json()) as unknown;
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function normalizeHistoryEntries(payload: unknown): RegistryHistoryEntry[] {
  const raw = asRecord(payload)?.entries;
  if (!Array.isArray(raw)) return [];
  const list = raw.filter((entry): entry is Record<string, unknown> => Boolean(entry));
  return list.map((entry) => {
    const timestamp = entry.block_timestamp;
    return {
      key: typeof entry.key === "string" ? entry.key : undefined,
      blockHeight: typeof entry.block_height === "number" ? entry.block_height : 0,
      blockTimestampNs:
        typeof timestamp === "number" || typeof timestamp === "string" ? timestamp : "",
      txHash: typeof entry.tx_hash === "string" ? entry.tx_hash : undefined,
      value:
        typeof entry.value === "string" && entry.value.length > 0
          ? parseJsonValue(entry.value)
          : entry.value,
    };
  });
}

export function buildDeployHistoryService(fetchJson: HistoryFetch): {
  listDeploys: (input: ListDeploysInput) => Effect.Effect<DeploySummary[], DeployHistoryReadError>;
} {
  const listDeploys = (
    input: ListDeploysInput,
  ): Effect.Effect<DeploySummary[], DeployHistoryReadError> =>
    Effect.gen(function* () {
      const limit = Math.max(1, Math.min(input.limit, FASTKV_HISTORY_MAX_LIMIT));
      const keyPrefix = auditManifestKeyPrefix(input.account, input.gateway);
      const configKey = registryConfigKey(input.account, input.gateway);
      const platformKey = platformManifestKey(input.account, input.gateway);

      const [manifestPayload, configPayload, platformPayload] = yield* Effect.tryPromise({
        try: () =>
          Promise.all([
            fetchJson(historyUrlForPrefix({ account: input.account, keyPrefix, limit }), {
              method: "POST",
              body: JSON.stringify(historyPrefixBody({ keyPrefix, limit })),
            }),
            fetchJson(historyUrlForKey({ account: input.account, keyPath: configKey, limit })),
            fetchJson(historyUrlForKey({ account: input.account, keyPath: platformKey, limit })),
          ]),
        catch: (cause) =>
          new DeployHistoryReadError({
            message: `FastKV history read failed for ${input.account}/${input.gateway}`,
            cause,
          }),
      });

      return assembleDeployRows({
        manifestEntries: normalizeHistoryEntries(manifestPayload).sort(
          (a, b) => b.blockHeight - a.blockHeight,
        ),
        configEntries: normalizeHistoryEntries(configPayload).sort(
          (a, b) => b.blockHeight - a.blockHeight,
        ),
        platformEntries: normalizeHistoryEntries(platformPayload).sort(
          (a, b) => b.blockHeight - a.blockHeight,
        ),
      });
    });

  return { listDeploys };
}

export class DeployHistoryService extends Context.Service<
  DeployHistoryService,
  {
    listDeploys: (
      input: ListDeploysInput,
    ) => Effect.Effect<DeploySummary[], DeployHistoryReadError>;
  }
>()("api/DeployHistoryService") {
  static readonly layer = Layer.succeed(this, this.of(buildDeployHistoryService(fetchHistoryJson)));
}
