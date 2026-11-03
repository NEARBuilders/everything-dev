/**
 * The resolution state machine (sprint registry-primitive, ticket 03): one
 * authored pin or latest query in, one structured outcome out.
 *
 * Queries: `Pinned | Latest → Resolved | Unresolved`.
 * - `Pinned(ref, release)` scans the extends chain's version records —
 *   immutable, so a root release never strands a child pin (#574).
 * - `Latest(ref)` reads the manifest tag — the moving pointer.
 * - `Unresolved` carries a structured reason (`absent | unreachable |
 *   integrityFailure`) plus manifest context: what the tag serves, the
 *   extends chain walked, and the dead-end diagnostic — when the chain
 *   terminates at a runtime that publishes no manifest legs, the outcome
 *   says so with the terminus's last write date (the permanent lesson of
 *   the false FastKV data-loss alarm: `dev.everything.dev` is an abandoned
 *   dead-end gateway; the release root is `dev.everything.near/everything.dev`).
 * - The thin-tag digest chain: post-cutover the tag is `{ version, digest }`;
 *   resolution verifies the digest against the fetched version record's bytes
 *   before returning — a mismatch is `Unresolved(integrityFailure)`, never a
 *   silent pass.
 *
 * The cache (`registry/cache.ts`) is the stand-in layer: pin-match + TTL,
 * offline dev only. All I/O is injectable — the test seam.
 */
import { createHash } from "node:crypto";
import { getExtendsRef, parseBosRef } from "../../utils/bos-ref";
import { type Manifest, ManifestSchema } from "../platform/manifest-schema";
import { fetchParentConfig } from "../resolution/init-source";
import {
  MANIFEST_CACHE_TTL_MS,
  type ManifestCacheRead,
  type ManifestCacheRecord,
  readManifestCache,
  writeManifestCache,
} from "./cache";
import { fetchConfigHistory, fetchRegistryKey, fetchRegistryKeyOrNull } from "./fastkv";
import { parseRuntimeRef, type RuntimeRef, runtimeRefOf } from "./keys";

export interface ExtendsChainNode {
  account: string;
  gateway: string;
}

export interface ExtendsChainWalk {
  /** child → root, nearest first — `chain[0]` is the local extends target */
  chain: ExtendsChainNode[];
  /** the most rootward `repository` seen — parent configs override the child's */
  repository?: string;
  /** set when the walk revisits a node — a pathological extends chain */
  circularAt?: string;
}

/**
 * The ONE extends-chain walk (child → root via registry parent configs): the
 * resolution machine and the upgrade source resolution share this
 * implementation. A fetch failure (throw or null) stops the walk — the chain
 * gathered so far is still returned.
 */
export async function walkExtendsChain(input: {
  localConfig: Record<string, unknown>;
  localRepository?: string;
  fetchParent?: (account: string, gateway: string) => Promise<Record<string, unknown> | null>;
}): Promise<ExtendsChainWalk> {
  const fetchParent =
    input.fetchParent ??
    (async (account: string, gateway: string) =>
      fetchParentConfig(account, gateway)
        .then((config) => config as Record<string, unknown>)
        .catch(() => null));
  const chain: ExtendsChainNode[] = [];
  let repository = input.localRepository;

  const startsRef = getExtendsRef(input.localConfig);
  let cursor: ExtendsChainNode | null =
    typeof startsRef === "string" && startsRef.startsWith("bos://")
      ? (parseBosRef(startsRef) ?? null)
      : null;
  const visited = new Set<string>();
  let circularAt: string | undefined;

  while (cursor) {
    const ref = `bos://${cursor.account}/${cursor.gateway}`;
    if (visited.has(ref)) {
      circularAt = ref;
      break;
    }
    visited.add(ref);
    chain.push(cursor);

    const parentConfig = await fetchParent(cursor.account, cursor.gateway);
    if (!parentConfig) break;
    if (typeof parentConfig.repository === "string" && parentConfig.repository) {
      repository = parentConfig.repository;
    }
    const nextRef = getExtendsRef(parentConfig);
    cursor =
      typeof nextRef === "string" && nextRef.startsWith("bos://")
        ? (parseBosRef(nextRef) ?? null)
        : null;
  }

  return {
    chain,
    ...(repository !== undefined ? { repository } : {}),
    ...(circularAt ? { circularAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// the machine

export type ResolutionQuery =
  | { readonly kind: "Pinned"; readonly release: string; readonly ref?: RuntimeRef }
  | { readonly kind: "Latest"; readonly ref?: RuntimeRef };

/** What the tag home serves: the thin `{ version, digest }` pointer
 * (post-cutover), the full manifest (the pre-cutover pointer), or nothing. */
export type TagServes = "thin" | "full" | "none";

export interface DeadEndContext {
  ref: RuntimeRef;
  /** The terminus's last registry write, when the history endpoint served one. */
  lastWrite?: string;
}

/** A type alias (not an interface) so the shape stays assignable to
 * `Record<string, unknown>` across the RPC contract boundary. */
export type ResolutionContext = {
  /** child → root, nearest first — the chain that was scanned */
  chain: readonly RuntimeRef[];
  tagServes: TagServes;
  /** the node a read or parse failed on, when the outcome is unreachable */
  failureAt?: { account: string; gateway: string };
  /** set when the chain terminates at a runtime that publishes no manifest
   * legs — "is this the runtime you meant?" */
  deadEnd?: DeadEndContext;
};

export type ResolutionOutcome =
  | {
      readonly state: "Resolved";
      readonly manifest: Manifest;
      /** the chain node that served the bytes */
      readonly source: { account: string; gateway: string };
      /** which home resolved the query: a version record (pinned), the
       * manifest tag (latest), or the cache stand-in */
      readonly from: "version" | "manifest" | "cache";
      readonly provenance: "slot" | "pointer";
      readonly fromCache: boolean;
    }
  | {
      readonly state: "Unresolved";
      readonly reason: "absent" | "unreachable" | "integrityFailure";
      readonly detail?: string;
      readonly context: ResolutionContext;
    };

export interface ResolutionSeams {
  /** The tag home (`manifest.json` post-cutover). Null = absent; throws =
   * unreachable. */
  readManifestTag(ref: RuntimeRef): Promise<unknown>;
  /** The immutable version record's raw bytes (the digest chain verifies
   * over text). Null = absent; throws = unreachable. */
  readVersionRecord(ref: RuntimeRef, release: string): Promise<string | null>;
  /** Parse a full manifest or record payload. Throws on a corrupt payload —
   * the machine records it as unreachable. */
  parseManifest(value: unknown): Manifest;
  fetchParent(account: string, gateway: string): Promise<Record<string, unknown> | null>;
  cacheRead(pin?: string): ManifestCacheRead;
  cacheWrite(record: ManifestCacheRecord): void;
  /** Best-effort last-write date for the dead-end diagnostic — failures are
   * swallowed (the field is simply omitted). */
  lastWriteAt?(ref: RuntimeRef): Promise<string | undefined>;
}

const refOf = (node: ExtendsChainNode): RuntimeRef =>
  runtimeRefOf({ accountId: node.account, gatewayId: node.gateway });

/** True when the tag payload is the thin `{ version, digest }` pointer —
 * the post-cutover wire that carries its own integrity reference. */
function isThinTag(value: unknown): value is { version: string; digest: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { version?: unknown }).version === "string" &&
    typeof (value as { digest?: unknown }).digest === "string"
  );
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function probeDeadEnd(
  seams: ResolutionSeams,
  terminus: ExtendsChainNode,
): Promise<DeadEndContext | undefined> {
  try {
    const tag = await seams.readManifestTag(refOf(terminus));
    if (tag) return undefined;
  } catch {
    // unreachable tag home — keep probing
  }
  const deadEnd: DeadEndContext = { ref: refOf(terminus) };
  if (seams.lastWriteAt) {
    try {
      const lastWrite = await seams.lastWriteAt(refOf(terminus));
      if (lastWrite) deadEnd.lastWrite = lastWrite;
    } catch {
      // best-effort
    }
  }
  return deadEnd;
}

export async function resolveRelease(input: {
  query: ResolutionQuery;
  localConfig: Record<string, unknown>;
  localRepository?: string;
  /** The cache location for the default (pre-cutover) seams. */
  configDir?: string;
  /** Partial overrides over the production seams — the test hook. */
  seams?: Partial<ResolutionSeams>;
  fetchParent?: (account: string, gateway: string) => Promise<Record<string, unknown> | null>;
  now?: () => number;
}): Promise<ResolutionOutcome> {
  const now = input.now ?? Date.now;
  const defaults = preCutoverSeams(input.configDir ?? process.cwd(), now);
  const seams: ResolutionSeams = { ...defaults, ...input.seams };
  const { chain } = await walkExtendsChain({
    localConfig: input.localConfig,
    ...(input.localRepository !== undefined ? { localRepository: input.localRepository } : {}),
    ...(input.fetchParent ? { fetchParent: input.fetchParent } : {}),
  });
  const chainRefs = chain.map(refOf);

  const writeCache = (
    manifest: Manifest,
    node: ExtendsChainNode,
    provenance: "slot" | "pointer",
  ): void => {
    seams.cacheWrite({
      schemaVersion: 1,
      kind: "everything-dev/platform-manifest-cache",
      resolvedAt: new Date(now()).toISOString(),
      source: { account: node.account, gateway: node.gateway },
      manifest,
      provenance,
    });
  };

  const deadEndProbe = async (): Promise<DeadEndContext | undefined> => {
    const terminus = chain.at(-1);
    return terminus ? probeDeadEnd(seams, terminus) : undefined;
  };

  if (input.query.kind === "Pinned") {
    const release = input.query.release;
    for (const node of chain) {
      let text: string | null;
      try {
        text = await seams.readVersionRecord(refOf(node), release);
      } catch (error) {
        // The record read failed: the offline cache may stand in (pin-match
        // + TTL — an offline-dev aid, not stale-pin grace) — otherwise the
        // outcome is unreachable with the failure node named.
        const cached = seams.cacheRead(release);
        if (cached.state === "hit") {
          return {
            state: "Resolved",
            manifest: cached.record.manifest,
            source: cached.record.source,
            from: "cache",
            provenance: cached.record.provenance ?? "slot",
            fromCache: true,
          };
        }
        return {
          state: "Unresolved",
          reason: "unreachable",
          detail: error instanceof Error ? error.message : String(error),
          context: { chain: chainRefs, tagServes: "none", failureAt: node },
        };
      }
      if (text !== null) {
        let manifest: Manifest;
        try {
          manifest = seams.parseManifest(JSON.parse(text));
        } catch (error) {
          return {
            state: "Unresolved",
            reason: "unreachable",
            detail: error instanceof Error ? error.message : String(error),
            context: { chain: chainRefs, tagServes: "none", failureAt: node },
          };
        }
        writeCache(manifest, node, "slot");
        return {
          state: "Resolved",
          manifest,
          source: { account: node.account, gateway: node.gateway },
          from: "version",
          provenance: "slot",
          fromCache: false,
        };
      }
    }
    // Record miss across the chain — the release's manifest leg never
    // published (the npm-version-exists / manifest-not-published race,
    // #568). Slots are immutable, so this state means the release deploy
    // must be re-run.
    const deadEnd = await deadEndProbe();
    return {
      state: "Unresolved",
      reason: "absent",
      detail:
        "no version record in the extends chain" +
        (chainRefs.length > 0 ? ` (${chainRefs.join(" → ")})` : "") +
        ` — the release's manifest leg never published ${release}; re-run the release deploy (or \`bos upgrade\` to re-pin)`,
      context: {
        chain: chainRefs,
        tagServes: "none",
        ...(deadEnd ? { deadEnd } : {}),
      },
    };
  }

  // Latest: read the tag — the moving pointer.
  let unreachable: { detail: string; node: ExtendsChainNode } | undefined;
  let tagServes: TagServes = "none";
  for (const node of chain) {
    let tag: unknown;
    try {
      tag = await seams.readManifestTag(refOf(node));
    } catch (error) {
      unreachable = {
        detail: error instanceof Error ? error.message : String(error),
        node,
      };
      break;
    }
    if (!tag) continue;
    if (isThinTag(tag)) {
      tagServes = "thin";
      let text: string | null;
      try {
        text = await seams.readVersionRecord(refOf(node), tag.version);
      } catch (error) {
        return {
          state: "Unresolved",
          reason: "unreachable",
          detail: error instanceof Error ? error.message : String(error),
          context: { chain: chainRefs, tagServes, failureAt: node },
        };
      }
      if (text === null) {
        return {
          state: "Unresolved",
          reason: "absent",
          detail: `the manifest tag names ${tag.version} but its version record is absent at ${refOf(node)}`,
          context: { chain: chainRefs, tagServes },
        };
      }
      if (sha256Hex(text) !== tag.digest) {
        return {
          state: "Unresolved",
          reason: "integrityFailure",
          detail: `the manifest tag's digest does not match the version record's bytes at ${refOf(node)} — refusing`,
          context: { chain: chainRefs, tagServes },
        };
      }
      let manifest: Manifest;
      try {
        manifest = seams.parseManifest(JSON.parse(text));
      } catch (error) {
        return {
          state: "Unresolved",
          reason: "unreachable",
          detail: error instanceof Error ? error.message : String(error),
          context: { chain: chainRefs, tagServes, failureAt: node },
        };
      }
      writeCache(manifest, node, "pointer");
      return {
        state: "Resolved",
        manifest,
        source: { account: node.account, gateway: node.gateway },
        from: "manifest",
        provenance: "pointer",
        fromCache: false,
      };
    }
    // full manifest tag (pre-cutover pointer)
    tagServes = "full";
    let manifest: Manifest;
    try {
      manifest = seams.parseManifest(tag);
    } catch (error) {
      unreachable = {
        detail: error instanceof Error ? error.message : String(error),
        node,
      };
      break;
    }
    writeCache(manifest, node, "pointer");
    return {
      state: "Resolved",
      manifest,
      source: { account: node.account, gateway: node.gateway },
      from: "manifest",
      provenance: "pointer",
      fromCache: false,
    };
  }

  if (unreachable) {
    return {
      state: "Unresolved",
      reason: "unreachable",
      detail: unreachable.detail,
      context: { chain: chainRefs, tagServes, failureAt: unreachable.node },
    };
  }

  const cached = seams.cacheRead();
  if (cached.state === "hit") {
    return {
      state: "Resolved",
      manifest: cached.record.manifest,
      source: cached.record.source,
      from: "cache",
      provenance: cached.record.provenance ?? "pointer",
      fromCache: true,
    };
  }
  const deadEnd = await deadEndProbe();
  return {
    state: "Unresolved",
    reason: "absent",
    context: {
      chain: chainRefs,
      tagServes,
      ...(deadEnd ? { deadEnd } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// the production seams — the pre-cutover transport

// TODO(cutover): the train still writes `platform.json` and
// `platform-versions/<v>.json` (ticket 10 flips the wire to `manifest.json` /
// `versions/<v>.json`). This transport and the two inline key templates read
// the current wire and are deleted at the cutover — the machine itself
// speaks only in RuntimeRef terms.
function tagKeyOf(account: string, gateway: string): string {
  return `apps/${account}/${gateway}/platform.json`;
}

function versionKeyOf(account: string, gateway: string, version: string): string {
  return `apps/${account}/${gateway}/platform-versions/${version}.json`;
}

function preCutoverSeams(configDir: string, now: () => number): ResolutionSeams {
  return {
    async readManifestTag(ref) {
      const { accountId, gatewayId } = parseRuntimeRef(ref);
      const raw = await fetchRegistryKeyOrNull<unknown>(accountId, gatewayId, "platform.json");
      return raw ?? null;
    },
    async readVersionRecord(ref, release) {
      const { accountId, gatewayId } = parseRuntimeRef(ref);
      // NOT the OrNull variant: a read failure must stay distinguishable
      // from a clean absent record — the machine fails loud with the node
      // named on a failure and treats null as absence. The key is the
      // SEGMENT relative to `apps/<account>/<gateway>/` — fetchRegistryKey
      // owns the prefix; a full key here double-prefixes and reads absent
      // forever (the stranded-pin incident).
      const raw = await fetchRegistryKey<unknown>(
        accountId,
        gatewayId,
        `platform-versions/${release}.json`,
      );
      return raw === null ? null : JSON.stringify(raw);
    },
    parseManifest(value) {
      return ManifestSchema.parse(value);
    },
    fetchParent(account, gateway) {
      return fetchParentConfig(account, gateway)
        .then((config) => config as Record<string, unknown>)
        .catch(() => null);
    },
    cacheRead(pin) {
      return readManifestCache({
        configDir,
        ...(pin !== undefined ? { pin } : {}),
        now,
      });
    },
    cacheWrite(record) {
      writeManifestCache({ configDir, record });
    },
    async lastWriteAt(ref) {
      try {
        const { accountId, gatewayId } = parseRuntimeRef(ref);
        const entries = await fetchConfigHistory({
          accountId,
          gatewayId,
          limit: 1,
          keyPath: tagKeyOf(accountId, gatewayId),
        });
        const ns = entries[0]?.blockTimestampNs;
        if (!ns) return undefined;
        const ms = Number(ns) / 1_000_000;
        return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// the compatibility adapter — the old resolver's exact signature and
// semantics, implemented on the machine. Callers consume the machine through
// this shape until the outcome-typed migration (ticket 05+).

export interface ResolvedPlatformManifest {
  manifest: Manifest;
  source: { account: string; gateway: string };
  fromCache: boolean;
  /** Where the resolved bytes came from (#574): an immutable version record
   * (an exact pin's target) or the moving tag (unpinned "latest"
   * resolution). */
  provenance: "slot" | "pointer";
}

export type PlatformManifestCache = ManifestCacheRecord;

export interface ResolvePlatformManifestOptions {
  configDir: string;
  localConfig: Record<string, unknown>;
  fetchManifest?: (account: string, gateway: string) => Promise<Manifest | null>;
  /** The immutable version-record read (#574) — an exact pin's target.
   * Throws on read failure (distinct from a clean absent record). */
  fetchSlot?: (account: string, gateway: string, version: string) => Promise<unknown>;
  fetchParent?: (account: string, gateway: string) => Promise<Record<string, unknown> | null>;
  cacheRead?: () => PlatformManifestCache | null;
  cacheWrite?: (cached: PlatformManifestCache) => void;
  /** injectable clock for the cache-freshness check (test seam) */
  now?: () => number;
  /** injectable freshness bound (test seam); defaults to {@link MANIFEST_CACHE_TTL_MS} */
  cacheTtlMs?: number;
}

export async function resolvePlatformManifest(
  opts: ResolvePlatformManifestOptions,
): Promise<ResolvedPlatformManifest | null> {
  const pin =
    typeof opts.localConfig.release === "string" && opts.localConfig.release
      ? opts.localConfig.release
      : undefined;

  const overrides: Partial<ResolutionSeams> = {};
  if (opts.fetchManifest) {
    overrides.readManifestTag = async (ref) => {
      const { accountId, gatewayId } = parseRuntimeRef(ref);
      return opts.fetchManifest!(accountId, gatewayId);
    };
  }
  if (opts.fetchSlot) {
    overrides.readVersionRecord = async (ref, release) => {
      const { accountId, gatewayId } = parseRuntimeRef(ref);
      const raw = await opts.fetchSlot!(accountId, gatewayId, release);
      return raw === null || raw === undefined ? null : JSON.stringify(raw);
    };
  }
  if (opts.cacheRead) {
    overrides.cacheRead = (pinKey) => {
      const record = opts.cacheRead?.();
      if (!record) return { state: "miss" };
      const now = (opts.now ?? Date.now)();
      const ttl = opts.cacheTtlMs ?? MANIFEST_CACHE_TTL_MS;
      const resolvedAt = Date.parse(record.resolvedAt);
      if (Number.isNaN(resolvedAt) || now - resolvedAt > ttl) return { state: "stale", record };
      if (pinKey !== undefined && record.manifest.frameworkVersion !== pinKey) {
        return { state: "stale", record };
      }
      return { state: "hit", record };
    };
  }
  if (opts.cacheWrite) {
    overrides.cacheWrite = (record) => opts.cacheWrite?.(record);
  }

  const query: ResolutionQuery = pin ? { kind: "Pinned", release: pin } : { kind: "Latest" };
  const outcome = await resolveRelease({
    query,
    localConfig: opts.localConfig,
    configDir: opts.configDir,
    ...(opts.now ? { now: opts.now } : {}),
    ...(Object.keys(overrides).length > 0 ? { seams: overrides } : {}),
    ...(opts.fetchParent ? { fetchParent: opts.fetchParent } : {}),
  });

  if (outcome.state === "Resolved") {
    return {
      manifest: outcome.manifest,
      source: outcome.source,
      fromCache: outcome.fromCache,
      provenance: outcome.provenance,
    };
  }

  // Unresolved → the old failure surface: null for clean absence on
  // latest, loud errors for everything a caller must act on.
  const chainUrls = outcome.context.chain.join(" → ");
  if (outcome.reason === "unreachable") {
    if (pin) {
      const node = outcome.context.failureAt;
      const slotKey = node
        ? versionKeyOf(node.account, node.gateway, pin)
        : `platform-versions/${pin}.json`;
      throw new Error(
        `platform pin ${pin}: the version slot read failed (${slotKey}): ${outcome.detail}`,
      );
    }
    throw new Error(outcome.detail ?? "the manifest tag read failed");
  }
  if (pin) {
    throw new Error(
      `platform pin ${pin}: no version slot in the extends chain` +
        (chainUrls ? ` (${chainUrls})` : "") +
        ` — the release's manifest leg never published it; re-run the release deploy (or \`bos upgrade\` to re-pin)`,
    );
  }
  return null;
}
