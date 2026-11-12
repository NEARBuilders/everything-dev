import { Context, Effect, Layer } from "effect";
import type { BosConfigInput } from "everything-dev";
import { mergeBosConfigWithExtends, resolveExtendsRef } from "everything-dev/config";
import {
  keyPathOf,
  latestUrlFor,
  ManifestSchema,
  networkIdForAccount,
  parseRuntimeRef,
  type RegistryClientShape,
  type ResolutionOutcome,
  registryBaseUrlForNetwork,
  registryClientShape,
  resolveRelease,
  runtimeRefOf,
} from "everything-dev/registry";
import { decodeSignedDelegateAction, isPrivateKey, Near } from "near-kit";
import { type RegistryConfig, RegistryConfigService } from "./config";

type PrivateKey = `ed25519:${string}` | `secp256k1:${string}`;
type JsonObject = Record<string, unknown>;

function assertPrivateKey(key: string): PrivateKey {
  if (!isPrivateKey(key)) {
    throw new Error(
      `Invalid private key format: must start with "ed25519:" or "secp256k1:". Got: ${key.slice(0, 10)}...`,
    );
  }
  return key as PrivateKey;
}

function createRelayNear(accountId: string, privateKey: string, network?: "mainnet" | "testnet") {
  return new Near({
    network: network ?? "mainnet",
    defaultSignerId: accountId,
    privateKey: assertPrivateKey(privateKey),
  });
}

export interface RegistryListInput {
  q?: string;
  parent?: string;
  root?: string;
  ancestor?: string;
  limit?: number;
  cursor?: string;
}

export interface RegistryMetadataDraftInput {
  accountId: string;
  gatewayId: string;
  claimedBy: string;
  title?: string;
  description?: string;
  repoUrl?: string;
  homepageUrl?: string;
  imageUrl?: string;
}

export interface RegistryMetadata {
  claimedBy: string | null;
  title: string | null;
  description: string | null;
  repoUrl: string | null;
  homepageUrl: string | null;
  imageUrl: string | null;
  updatedAt: string | null;
}

export interface RegistryAppSummary {
  accountId: string;
  gatewayId: string;
  canonicalKey: string;
  canonicalConfigUrl: string;
  startCommand: string;
  domain: string | null;
  openUrl: string | null;
  hostUrl: string | null;
  uiUrl: string | null;
  uiSsrUrl: string | null;
  apiUrl: string | null;
  extends: string | null;
  parent: string | null;
  root: string | null;
  depth: number;
  status: "ready" | "invalid";
  metadata: RegistryMetadata | null;
}

export interface RegistryAppDetail extends RegistryAppSummary {
  metadata: RegistryMetadata | null;
  metadataKey: string;
  metadataContractId: string;
  metadataFastKvUrl: string;
  extendsChain: string[];
  resolvedConfig: JsonObject;
}

export interface RegistryLineage {
  parent: string | null;
  root: string | null;
  depth: number;
  extendsChain: string[];
}

export interface ResolvedPublishedRuntime {
  resolvedConfig: BosConfigInput;
  lineage: RegistryLineage;
}

export interface PreparedRegistryMetadataWrite {
  contractId: string;
  methodName: "__fastdata_kv";
  key: string;
  manifest: RegistryMetadata;
  args: Record<string, string>;
  gas: string;
  attachedDeposit: string;
}

export interface RegistryConfigWriteInput {
  accountId: string;
  gatewayId: string;
  config: Record<string, unknown>;
}

export interface PreparedRegistryConfigWrite {
  contractId: string;
  methodName: "__fastdata_kv";
  key: string;
  args: Record<string, string>;
  gas: string;
  attachedDeposit: string;
}

export interface RegistryRelayResult {
  transactionHash: string | null;
  relayerAccountId: string;
  senderId: string;
}

export interface ManifestReadInput {
  ref: string;
  includeVersionRecord?: boolean;
}

export interface ManifestReadResult {
  ref: string;
  tag: unknown;
  versionRecord: unknown;
}

export interface RuntimeResolveInput {
  ref: string;
  release?: string;
}

export interface RuntimeResolveResult {
  ref: string;
  outcome: ResolutionOutcome;
}

interface DiscoveredConfig {
  accountId: string;
  gatewayId: string;
  rawConfig: BosConfigInput;
}

const DISCOVERY_PREFIX = "apps/";
const CACHE_TTL_MS = 60_000;

interface DiscoveryCache {
  data: DiscoveredConfig[];
  expiresAt: number;
}

let discoveryCache: DiscoveryCache | null = null;

/** Test seam — the discovery cache is module-global. */
export function resetDiscoveryCache(): void {
  discoveryCache = null;
}

export interface KvEntry {
  key: string;
  value: unknown;
  blockHeight?: number;
  blockTimestamp?: number;
  txHash?: string;
  signerId?: string;
}

export interface KvListInput {
  prefix: string;
  limit?: number;
  cursor?: string;
}

export interface KvWriteEntry {
  path: string;
  value: unknown;
}

export interface PreparedKvWrite {
  contractId: string;
  methodName: "__fastdata_kv";
  args: Record<string, string>;
  gas: string;
  attachedDeposit: string;
}

export class RegistryService extends Context.Service<
  RegistryService,
  {
    listRegistryApps: (input: RegistryListInput) => Promise<{
      data: RegistryAppSummary[];
      meta: { total: number; hasMore: boolean; nextCursor: string | null };
    }>;
    getRegistryAppsByAccount: (accountId: string) => Promise<{
      data: RegistryAppSummary[];
      meta: { total: number; hasMore: boolean; nextCursor: string | null };
    }>;
    getRegistryApp: (accountId: string, gatewayId: string) => Promise<RegistryAppDetail | null>;
    getRegistryAppByHost: (hostUrl: string) => Promise<RegistryAppDetail | null>;
    getRegistryStatus: () => Promise<{
      discoveredApps: number;
      metadataContractId: string;
      metadataFastKvUrl: string;
      relayEnabled: boolean;
      relayAccountId: string | null;
      timestamp: string;
    }>;
    prepareRegistryMetadataWrite: (
      input: RegistryMetadataDraftInput,
    ) => PreparedRegistryMetadataWrite;
    prepareRegistryConfigWrite: (input: RegistryConfigWriteInput) => PreparedRegistryConfigWrite;
    relayRegistryMetadataWrite: (
      signedDelegateActionPayload: string,
    ) => Promise<RegistryRelayResult>;
    getRegistryRelaySender: (signedDelegateActionPayload: string) => string;
    getManifest: (input: ManifestReadInput) => Promise<ManifestReadResult>;
    resolveRuntime: (input: RuntimeResolveInput) => Promise<RuntimeResolveResult>;
    kvGet: (path: string) => Promise<unknown>;
    kvList: (input: KvListInput) => Promise<{
      data: KvEntry[];
      meta: { total: number; hasMore: boolean; nextCursor: string | null };
    }>;
    kvPrepareWrite: (entries: KvWriteEntry[]) => PreparedKvWrite;
    kvRelayWrite: (signedDelegateActionPayload: string) => Promise<RegistryRelayResult>;
  }
>()("registry/RegistryService") {
  static Live = Layer.effect(
    RegistryService,
    Effect.gen(function* () {
      const config = yield* RegistryConfigService;
      return createRegistryMethods(config);
    }),
  );
}

function canonicalConfigKey(accountId: string, gatewayId: string): string {
  return keyPathOf({ kind: "runtimeConfig", ref: runtimeRefOf({ accountId, gatewayId }) });
}

/** The app-metadata key — the plugin's own domain surface (claims, title,
 * repo), not a release-contract key. */
function getRegistryMetadataKey(accountId: string, gatewayId: string): string {
  return `apps/${accountId}/${gatewayId}/manifest`;
}

export function createRegistryMethods(
  config: RegistryConfig,
  client: RegistryClientShape = registryClientShape,
) {
  const namespace = config.namespace;

  const discoverPublishedConfigs = async (): Promise<DiscoveredConfig[]> => {
    if (discoveryCache && Date.now() < discoveryCache.expiresAt) {
      return discoveryCache.data;
    }
    // Discovery lists the namespace's own network — the primitive derives
    // the host from the account, so the old cross-host scan with a
    // mismatched namespace string has no coherent primitive equivalent.
    const apps: DiscoveredConfig[] = [];
    let pageToken: string | undefined;

    for (;;) {
      const page = await client.list({
        ref: runtimeRefOf({ accountId: namespace, gatewayId: namespace }),
        keyPrefix: DISCOVERY_PREFIX,
        limit: 200,
        ...(pageToken ? { pageToken } : {}),
      });

      for (const entry of page.entries) {
        if (!entry.key.endsWith("/bos.config.json")) {
          continue;
        }

        const parsedKey = parseRegistryConfigKey(entry.key);
        if (!parsedKey) {
          continue;
        }

        const rawConfig = normalizeConfigValue(entry.value);
        if (!rawConfig) {
          continue;
        }

        apps.push({
          accountId: parsedKey.accountId,
          gatewayId: parsedKey.gatewayId,
          rawConfig,
        });
      }

      if (!page.pageToken) {
        break;
      }

      pageToken = page.pageToken;
    }

    const data = apps.sort(compareDiscovered);
    discoveryCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
  };

  const resolveAppSummary = async (item: DiscoveredConfig): Promise<RegistryAppSummary> => {
    const resolved = await resolvePublishedRuntime(
      item.accountId,
      item.gatewayId,
      item.rawConfig,
      config,
      client,
    );
    const metadata = await getRegistryMetadata(item.accountId, item.gatewayId);

    return {
      ...normalizeResolvedConfig(item.accountId, item.gatewayId, resolved),
      metadata,
    };
  };

  const normalizeResolvedConfig = (
    accountId: string,
    gatewayId: string,
    runtime: ResolvedPublishedRuntime,
  ): RegistryAppSummary => {
    const { resolvedConfig: configInput, lineage } = runtime;
    const hostConfig = getAppConfig(configInput, "host");
    const uiConfig = getAppConfig(configInput, "ui");
    const apiConfig = getAppConfig(configInput, "api");

    const hostUrl = readString(hostConfig.production);
    const uiUrl = readString(uiConfig.production);
    const apiUrl = readString(apiConfig.production);
    const uiSsrUrl = readString(uiConfig.ssr);
    const domain = readString(configInput.domain);
    const canonicalKey = canonicalConfigKey(accountId, gatewayId);

    return {
      accountId,
      gatewayId,
      canonicalKey,
      canonicalConfigUrl: latestUrlFor(
        { kind: "runtimeConfig", ref: runtimeRefOf({ accountId, gatewayId }) },
        { registry: namespace },
      ),
      startCommand: `bunx everything-dev@latest start --account ${accountId} --domain ${gatewayId}`,
      domain,
      openUrl: buildOpenUrl(domain),
      hostUrl,
      uiUrl,
      apiUrl,
      uiSsrUrl,
      extends: getBosExtends(configInput),
      parent: lineage.parent,
      root: lineage.root,
      depth: lineage.depth,
      status: hostUrl && uiUrl ? "ready" : "invalid",
      metadata: null,
    };
  };

  const getRegistryMetadata = async (
    accountId: string,
    gatewayId: string,
  ): Promise<RegistryMetadata | null> => {
    const metadataKey = getRegistryMetadataKey(accountId, gatewayId);
    const page = await client.list({
      ref: runtimeRefOf({ accountId, gatewayId }),
      keyPrefix: metadataKey,
      limit: 1,
    });
    const value = page.entries[0]?.value ?? null;

    if (!value) {
      return null;
    }

    const normalized = normalizeMetadataValue(value);

    return {
      claimedBy: readString(normalized.claimedBy),
      title: readString(normalized.title),
      description: readString(normalized.description),
      repoUrl: readString(normalized.repoUrl),
      homepageUrl: readString(normalized.homepageUrl),
      imageUrl: readString(normalized.imageUrl),
      updatedAt: readString(normalized.updatedAt),
    };
  };

  return {
    listRegistryApps: async (input: RegistryListInput) => {
      const limit = clamp(input.limit ?? 24, 1, 100);
      const offset = clamp(parseCursor(input.cursor), 0, Number.MAX_SAFE_INTEGER);
      const discovered = await discoverPublishedConfigs();
      const resolved = await Promise.all(
        discovered.map(async (item) => ({
          item,
          runtime: await resolvePublishedRuntime(
            item.accountId,
            item.gatewayId,
            item.rawConfig,
            config,
            client,
          ),
        })),
      );
      const filtered = resolved.filter(({ item, runtime }) =>
        matchesRegistryFilters(item.accountId, item.gatewayId, runtime.lineage, input),
      );
      const page = filtered.slice(offset, offset + limit);
      const data = await Promise.all(page.map(({ item }) => resolveAppSummary(item)));
      const nextOffset = offset + page.length;

      return {
        data,
        meta: {
          total: filtered.length,
          hasMore: nextOffset < filtered.length,
          nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
        },
      };
    },

    getRegistryAppsByAccount: async (accountId: string) => {
      const discovered = await discoverPublishedConfigs();
      const matches = discovered
        .filter((item) => item.accountId === accountId)
        .sort(compareDiscovered);
      const data = await Promise.all(matches.map(resolveAppSummary));

      return {
        data,
        meta: {
          total: data.length,
          hasMore: false,
          nextCursor: null,
        },
      };
    },

    getRegistryApp: async (accountId: string, gatewayId: string) => {
      const discovered = await discoverPublishedConfigs();
      const match = discovered.find(
        (item) => item.accountId === accountId && item.gatewayId === gatewayId,
      );

      if (!match) {
        return null;
      }

      const resolved = await resolvePublishedRuntime(
        accountId,
        gatewayId,
        match.rawConfig,
        config,
        client,
      );
      const normalized = normalizeResolvedConfig(accountId, gatewayId, resolved);
      const metadataKey = getRegistryMetadataKey(accountId, gatewayId);
      const metadata = await getRegistryMetadata(accountId, gatewayId);

      return {
        ...normalized,
        metadata,
        metadataKey,
        metadataContractId: namespace,
        metadataFastKvUrl: registryBaseUrlForNetwork(networkIdForAccount(accountId)),
        extendsChain: resolved.lineage.extendsChain,
        resolvedConfig: resolved.resolvedConfig as JsonObject,
      };
    },

    getRegistryAppByHost: async (hostUrl: string) => {
      const discovered = await discoverPublishedConfigs();

      for (const item of discovered) {
        const resolved = await resolvePublishedRuntime(
          item.accountId,
          item.gatewayId,
          item.rawConfig,
          config,
          client,
        );
        const normalized = normalizeResolvedConfig(item.accountId, item.gatewayId, resolved);

        if (normalized.hostUrl !== hostUrl) {
          continue;
        }

        const metadataKey = getRegistryMetadataKey(item.accountId, item.gatewayId);
        const metadata = await getRegistryMetadata(item.accountId, item.gatewayId);

        return {
          ...normalized,
          metadata,
          metadataKey,
          metadataContractId: namespace,
          metadataFastKvUrl: registryBaseUrlForNetwork(networkIdForAccount(item.accountId)),
          extendsChain: resolved.lineage.extendsChain,
          resolvedConfig: resolved.resolvedConfig as JsonObject,
        };
      }

      return null;
    },

    getRegistryStatus: async () => {
      const discovered = await discoverPublishedConfigs();
      return {
        discoveredApps: discovered.length,
        metadataContractId: namespace,
        metadataFastKvUrl: registryBaseUrlForNetwork(networkIdForAccount(namespace)),
        relayEnabled: Boolean(config.relayAccountId && config.relayPrivateKey),
        relayAccountId: config.relayAccountId ?? null,
        timestamp: new Date().toISOString(),
      };
    },

    prepareRegistryMetadataWrite: (input: RegistryMetadataDraftInput) => {
      const key = getRegistryMetadataKey(input.accountId, input.gatewayId);
      const manifest = buildRegistryManifest(input);

      return {
        contractId: namespace,
        methodName: "__fastdata_kv" as const,
        key,
        manifest,
        args: {
          [key]: JSON.stringify(manifest),
        },
        gas: "10 Tgas",
        attachedDeposit: "0 yocto",
      };
    },

    prepareRegistryConfigWrite: (input: RegistryConfigWriteInput) => {
      const key = canonicalConfigKey(input.accountId, input.gatewayId);

      return {
        contractId: namespace,
        methodName: "__fastdata_kv" as const,
        key,
        args: {
          [key]: JSON.stringify(input.config),
        },
        gas: "300 Tgas",
        attachedDeposit: "0 yocto",
      };
    },

    relayRegistryMetadataWrite: async (signedDelegateActionPayload: string) => {
      if (!config.relayAccountId || !config.relayPrivateKey) {
        throw new Error("Registry relay is not configured on this server.");
      }

      const signedDelegate = decodeSignedDelegateAction(signedDelegateActionPayload);
      const senderId = signedDelegate.signedDelegate.delegateAction.senderId;

      const near = createRelayNear(
        config.relayAccountId,
        config.relayPrivateKey,
        config.relayNetwork,
      );

      const result = await near
        .transaction(config.relayAccountId)
        .signedDelegateAction(signedDelegate)
        .send({ waitUntil: "NONE" });

      return {
        transactionHash: result?.transaction?.hash ?? null,
        relayerAccountId: config.relayAccountId,
        senderId,
      };
    },

    getRegistryRelaySender: (signedDelegateActionPayload: string) => {
      const signedDelegate = decodeSignedDelegateAction(signedDelegateActionPayload);
      return signedDelegate.signedDelegate.delegateAction.senderId;
    },

    getManifest: async (input: ManifestReadInput): Promise<ManifestReadResult> => {
      const parsed = parseRuntimeRef(input.ref);
      const ref = runtimeRefOf({ accountId: parsed.accountId, gatewayId: parsed.gatewayId });
      const tag = await client.readOrNull<unknown>({ kind: "manifest", ref });
      let versionRecord: unknown = null;
      if (input.includeVersionRecord && tag && typeof tag === "object" && tag !== null) {
        const version = (tag as { version?: unknown }).version;
        if (typeof version === "string" && version) {
          versionRecord = await client.readOrNull<unknown>({
            kind: "version",
            ref,
            version,
          });
        }
      }
      return { ref: input.ref, tag, versionRecord };
    },

    resolveRuntime: async (input: RuntimeResolveInput): Promise<RuntimeResolveResult> => {
      const parsed = parseRuntimeRef(input.ref);
      const refKey = runtimeRefOf({ accountId: parsed.accountId, gatewayId: parsed.gatewayId });
      const configKey =
        parsed.path.length > 0
          ? { kind: "runtimeConfig" as const, ref: refKey, path: parsed.path }
          : { kind: "runtimeConfig" as const, ref: refKey };
      await client.read<BosConfigInput>(configKey);
      const outcome = await resolveRelease({
        query: input.release
          ? { kind: "Pinned", release: input.release, ref: refKey }
          : { kind: "Latest", ref: refKey },
        // The walk starts AT the subject ref — its own config (fetched via
        // the fetchParent seam below) provides any further extends links.
        localConfig: { extends: input.ref },
        seams: {
          readManifestTag: async (r) => client.readOrNull<unknown>({ kind: "manifest", ref: r }),
          readVersionRecord: async (r, release) => {
            const record = await client.readOrNull<unknown>({
              kind: "version",
              ref: r,
              version: release,
            });
            return record === null ? null : JSON.stringify(record);
          },
          parseManifest: (value) => ManifestSchema.parse(value),
          fetchParent: async (account, gateway) => {
            try {
              const parent = await client.readOrNull<BosConfigInput>({
                kind: "runtimeConfig",
                ref: runtimeRefOf({ accountId: account, gatewayId: gateway }),
              });
              return (parent as Record<string, unknown> | null) ?? null;
            } catch {
              return null;
            }
          },
          cacheRead: () => ({ state: "miss" }),
          cacheWrite: () => {},
        },
      });
      return { ref: input.ref, outcome };
    },

    kvGet: async (path: string) => {
      const accountIdMatch = path.match(/^plugins\/([^/]+)\//);
      const accountId = accountIdMatch?.[1] ?? namespace;
      const page = await client.list({
        ref: runtimeRefOf({ accountId, gatewayId: namespace }),
        keyPrefix: path,
        limit: 1,
      });
      return page.entries[0]?.value ?? null;
    },

    kvList: async (input: KvListInput) => {
      const accountIdMatch = input.prefix.match(/^plugins\/([^/]+)\//);
      const accountId = accountIdMatch?.[1] ?? namespace;
      const limit = clamp(input.limit ?? 50, 1, 200);
      const allEntries: KvEntry[] = [];
      let pageToken: string | null = input.cursor ?? null;
      let lastPageToken: string | null = null;

      for (;;) {
        const page = await client.list({
          ref: runtimeRefOf({ accountId, gatewayId: namespace }),
          keyPrefix: input.prefix,
          limit,
          includeMetadata: true,
          ...(pageToken ? { pageToken } : {}),
        });

        for (const entry of page.entries) {
          allEntries.push({
            key: entry.key,
            value: entry.value,
            blockHeight: entry.blockHeight,
            blockTimestamp: Number(entry.blockTimestampNs) || undefined,
            txHash: entry.txHash,
          });
        }

        lastPageToken = page.pageToken;
        if (!page.pageToken) break;
        if (allEntries.length >= limit) break;
        pageToken = page.pageToken;
      }

      const hasMore = lastPageToken != null;
      return {
        data: allEntries.slice(0, limit),
        meta: {
          total: allEntries.length,
          hasMore,
          nextCursor: hasMore ? lastPageToken : null,
        },
      };
    },

    kvPrepareWrite: (entries: KvWriteEntry[]) => {
      const args: Record<string, string> = {};
      for (const { path, value } of entries) {
        args[path] = JSON.stringify(value);
      }
      return {
        contractId: namespace,
        methodName: "__fastdata_kv" as const,
        args,
        gas: `${Math.max(10, entries.length * 5)} Tgas`,
        attachedDeposit: "0 yocto",
      };
    },

    kvRelayWrite: async (signedDelegateActionPayload: string) => {
      if (!config.relayAccountId || !config.relayPrivateKey) {
        throw new Error("Registry relay is not configured on this server.");
      }

      const signedDelegate = decodeSignedDelegateAction(signedDelegateActionPayload);
      const senderId = signedDelegate.signedDelegate.delegateAction.senderId;

      const near = createRelayNear(
        config.relayAccountId,
        config.relayPrivateKey,
        config.relayNetwork,
      );

      const result = await near
        .transaction(config.relayAccountId)
        .signedDelegateAction(signedDelegate)
        .send({ waitUntil: "NONE" });

      return {
        transactionHash: result?.transaction?.hash ?? null,
        relayerAccountId: config.relayAccountId,
        senderId,
      };
    },
  };
}

function buildRegistryManifest(input: RegistryMetadataDraftInput): RegistryMetadata {
  return {
    claimedBy: input.claimedBy,
    title: sanitizeNullable(input.title),
    description: sanitizeNullable(input.description),
    repoUrl: sanitizeNullable(input.repoUrl),
    homepageUrl: sanitizeNullable(input.homepageUrl),
    imageUrl: sanitizeNullable(input.imageUrl),
    updatedAt: new Date().toISOString(),
  };
}

export async function resolvePublishedRuntime(
  accountId: string,
  gatewayId: string,
  configInput: BosConfigInput,
  registryConfig: RegistryConfig,
  client: RegistryClientShape = registryClientShape,
  visited = new Set<string>(),
): Promise<ResolvedPublishedRuntime> {
  const selfRef = `bos://${accountId}/${gatewayId}`;
  if (visited.has(selfRef)) {
    throw new Error(`Circular extends detected for ${selfRef}`);
  }

  const nextVisited = new Set(visited);
  nextVisited.add(selfRef);
  const parentRef = getBosExtends(configInput);

  if (!parentRef) {
    return {
      resolvedConfig: configInput,
      lineage: {
        parent: null,
        root: selfRef,
        depth: 0,
        extendsChain: [selfRef],
      },
    };
  }

  const parsedParent = parseRuntimeRef(parentRef);
  const parentKey = runtimeRefOf({
    accountId: parsedParent.accountId,
    gatewayId: parsedParent.gatewayId,
  });
  const parentConfig = await client.read<BosConfigInput>(
    parsedParent.path.length > 0
      ? { kind: "runtimeConfig", ref: parentKey, path: parsedParent.path }
      : { kind: "runtimeConfig", ref: parentKey },
  );
  const parentAccountId = parsedParent.accountId;
  const parentGatewayId = parsedParent.gatewayId;
  const parentResolved = await resolvePublishedRuntime(
    parentAccountId,
    parentGatewayId,
    parentConfig,
    registryConfig,
    client,
    nextVisited,
  );

  return {
    resolvedConfig: mergeBosConfigWithExtends(parentResolved.resolvedConfig, configInput),
    lineage: {
      parent: parentRef,
      root: parentResolved.lineage.root,
      depth: parentResolved.lineage.depth + 1,
      extendsChain: [selfRef, ...parentResolved.lineage.extendsChain],
    },
  };
}

function getAppConfig(config: BosConfigInput, appName: string): JsonObject {
  const app = config.app?.[appName];
  return app && typeof app === "object" ? app : {};
}

function normalizeMetadataValue(value: unknown): JsonObject {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    return parseJson<JsonObject>(value) ?? {};
  }

  if (typeof value === "object") {
    return value as JsonObject;
  }

  return {};
}

function normalizeConfigValue(value: unknown): BosConfigInput | null {
  if (typeof value === "string") {
    return parseJson<BosConfigInput>(value);
  }

  if (value && typeof value === "object") {
    return value as BosConfigInput;
  }

  return null;
}

function parseRegistryConfigKey(key: string): { accountId: string; gatewayId: string } | null {
  const match = key.match(/^apps\/([^/]+)\/([^/]+)\/bos\.config\.json$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    accountId: match[1],
    gatewayId: match[2],
  };
}

function matchesQuery(accountId: string, gatewayId: string, query?: string) {
  if (!query) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    accountId.toLowerCase().includes(normalized) || gatewayId.toLowerCase().includes(normalized)
  );
}

function matchesRegistryFilters(
  accountId: string,
  gatewayId: string,
  lineage: RegistryLineage,
  input: RegistryListInput,
) {
  if (!matchesQuery(accountId, gatewayId, input.q)) {
    return false;
  }

  if (input.parent && lineage.parent !== input.parent) {
    return false;
  }

  if (input.root && lineage.root !== input.root) {
    return false;
  }

  if (input.ancestor && !lineage.extendsChain.slice(1).includes(input.ancestor)) {
    return false;
  }

  return true;
}

function compareDiscovered(a: DiscoveredConfig, b: DiscoveredConfig) {
  return `${a.accountId}/${a.gatewayId}`.localeCompare(`${b.accountId}/${b.gatewayId}`);
}

function parseCursor(cursor?: string) {
  const value = Number(cursor ?? "0");
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function buildOpenUrl(domain: string | null) {
  if (!domain) return null;
  if (domain.endsWith(".localhost") || domain === "localhost" || domain === "127.0.0.1") {
    return null;
  }
  return `https://${domain}`;
}

function sanitizeNullable(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getBosExtends(configInput: BosConfigInput) {
  const extendsRef = resolveExtendsRef(configInput.extends, "production");
  return extendsRef?.startsWith("bos://") ? extendsRef : null;
}
