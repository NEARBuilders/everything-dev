import { Context, Data, Effect, Layer } from "effect";
import { pointerDigest } from "everything-dev/digest";
import {
  type DeployRecord,
  DeployRecordSchema,
  deployRecordTsOf,
  keyPathOf,
  ManifestTagSchema,
  PlatformManifestPinSchema,
  RegistryError,
  type RegistryHistoryEntry,
  type RegistryKey,
  registryClientShape,
  runtimeRefOf,
} from "everything-dev/registry";
import { type DeployManifestEntry, fetchDeployManifests } from "everything-dev/registry/fastkv";
import { z } from "zod";

export const DeploySummarySchema = z.object({
  key: z.string(),
  publishedAt: z.string(),
  network: z.string().optional(),
  registryUrl: z.string().optional(),
  pointerDigest: z.string().optional(),
  platformManifest: PlatformManifestPinSchema.optional(),
  releaseVersion: z.string().optional(),
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

const FASTKV_HISTORY_MAX_LIMIT = 200;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rolledBackFromOf(configValue: unknown): string | undefined {
  const record = asRecord(configValue);
  return typeof record?.rolledBackFrom === "string" ? record.rolledBackFrom : undefined;
}

export interface ImagePin {
  image: string;
  tag: string;
}

/** The serving image's pin in a release record (`image: { ref, tags }`) —
 * the registry digest itself is never persisted (it is resolved per deploy,
 * ticket 08). */
export function imagePinOfVersionRecord(value: unknown): ImagePin | undefined {
  const record = asRecord(value);
  const image = asRecord(record?.image);
  if (typeof image?.ref !== "string" || image.ref.length === 0) return undefined;
  const tags = Array.isArray(image.tags) ? image.tags : [];
  const tag = tags.find((t): t is string => typeof t === "string" && t.length > 0);
  return tag ? { image: image.ref, tag } : undefined;
}

export function imageRefOfPin(pin: ImagePin): string {
  return `${pin.image}:${pin.tag}`;
}

/** The release version in force at a block — the newest `manifest.json` flip
 * at or before the deploy's block (the tag only moves on release legs, so
 * deploys without a release pointer reuse the version still active). */
export function releaseVersionAtBlock(
  tagEntries: RegistryHistoryEntry[],
  blockHeight: number,
): string | undefined {
  const candidates = [...tagEntries]
    .filter((entry) => entry.blockHeight <= blockHeight)
    .sort((a, b) => b.blockHeight - a.blockHeight);
  for (const entry of candidates) {
    const tag = ManifestTagSchema.safeParse(entry.value);
    if (tag.success) return tag.data.version;
  }
  return undefined;
}

/** The record's registry key, re-derived through the key model for history
 * entries the endpoint served without a key. */
function deployRecordKeyOf(record: DeployRecord): string {
  return keyPathOf({
    kind: "deployRecord",
    ref: runtimeRefOf({ accountId: record.account, gatewayId: record.gateway }),
    ts: deployRecordTsOf(record.publishedAt),
  });
}

export interface DeployHistorySource {
  /** The `deploys/<ts>.json` key family, newest-first (the train writes one
   * record per publish, atomically with the tag swap). */
  listDeployRecords: (opts: {
    accountId: string;
    gatewayId: string;
    limit: number;
  }) => Promise<DeployManifestEntry[]>;
  /** Exact-key history for a registry key, newest-first — the config join
   * and the manifest-tag fallback. */
  keyHistory: (key: RegistryKey, limit: number) => Promise<RegistryHistoryEntry[]>;
  /** Latest-state read of a registry key; an absent key resolves to null
   * (an unreachable registry must still throw — a swallowed failure would
   * silently drop the image pin). */
  readVersionRecord: (key: RegistryKey) => Promise<unknown>;
}

export const DeployHistorySourceLive: DeployHistorySource = {
  listDeployRecords: (opts) => fetchDeployManifests(opts),
  keyHistory: (key, limit) => registryClientShape.history(key, limit),
  readVersionRecord: async (key) => {
    try {
      return await registryClientShape.read(key);
    } catch (error) {
      if (error instanceof RegistryError && error.kind === "absent") return null;
      throw error;
    }
  },
};

export async function assembleDeployRows(opts: {
  records: DeployManifestEntry[];
  configEntries: RegistryHistoryEntry[];
  manifestTagEntries: RegistryHistoryEntry[];
  readVersionRecord: (version: string) => Promise<unknown>;
}): Promise<DeploySummary[]> {
  const configByBlock = new Map<number, unknown>();
  for (const entry of opts.configEntries) {
    if (!configByBlock.has(entry.blockHeight)) {
      configByBlock.set(entry.blockHeight, entry.value);
    }
  }
  const tagEntries = [...opts.manifestTagEntries].sort((a, b) => b.blockHeight - a.blockHeight);
  const pinCache = new Map<string, Promise<ImagePin | undefined>>();

  const imagePinFor = (version: string): Promise<ImagePin | undefined> => {
    const cached = pinCache.get(version);
    if (cached) return cached;
    const pin = opts.readVersionRecord(version).then(imagePinOfVersionRecord);
    pinCache.set(version, pin);
    return pin;
  };

  const rows: DeploySummary[] = [];
  for (const entry of opts.records) {
    const parsed = DeployRecordSchema.safeParse(entry.value);
    if (!parsed.success) continue;
    const record = parsed.data;
    const joinedConfig = configByBlock.get(entry.blockHeight);
    const pointerDigestValue = asRecord(joinedConfig)
      ? pointerDigest(joinedConfig as Parameters<typeof pointerDigest>[0])
      : undefined;
    const releaseVersion =
      record.platformManifest?.version ?? releaseVersionAtBlock(tagEntries, entry.blockHeight);
    const pin = releaseVersion ? await imagePinFor(releaseVersion) : undefined;
    rows.push({
      key: entry.key || deployRecordKeyOf(record),
      publishedAt: record.publishedAt,
      network: record.network,
      registryUrl: record.registryUrl,
      pointerDigest: pointerDigestValue,
      platformManifest: record.platformManifest,
      releaseVersion,
      imageRef: pin ? imageRefOfPin(pin) : undefined,
      rolledBackFrom: rolledBackFromOf(joinedConfig),
      blockHeight: entry.blockHeight,
    });
  }
  return rows;
}

export function buildDeployHistoryService(source: DeployHistorySource = DeployHistorySourceLive): {
  listDeploys: (input: ListDeploysInput) => Effect.Effect<DeploySummary[], DeployHistoryReadError>;
} {
  const listDeploys = (
    input: ListDeploysInput,
  ): Effect.Effect<DeploySummary[], DeployHistoryReadError> =>
    Effect.gen(function* () {
      const limit = Math.max(1, Math.min(input.limit, FASTKV_HISTORY_MAX_LIMIT));
      const ref = runtimeRefOf({ accountId: input.account, gatewayId: input.gateway });
      const readError = (cause: unknown) =>
        new DeployHistoryReadError({
          message: `FastKV history read failed for ${input.account}/${input.gateway}`,
          cause,
        });

      const [records, configEntries, tagEntries] = yield* Effect.tryPromise({
        try: () =>
          Promise.all([
            source.listDeployRecords({ accountId: input.account, gatewayId: input.gateway, limit }),
            source.keyHistory({ kind: "runtimeConfig", ref }, limit),
            source.keyHistory({ kind: "manifest", ref }, limit),
          ]),
        catch: readError,
      });

      return yield* Effect.tryPromise({
        try: () =>
          assembleDeployRows({
            records: [...records].sort((a, b) => b.blockHeight - a.blockHeight),
            configEntries: [...configEntries].sort((a, b) => b.blockHeight - a.blockHeight),
            manifestTagEntries: [...tagEntries].sort((a, b) => b.blockHeight - a.blockHeight),
            readVersionRecord: (version) =>
              source.readVersionRecord({ kind: "version", ref, version }),
          }),
        catch: readError,
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
  static readonly layer = Layer.succeed(this, this.of(buildDeployHistoryService()));
}
