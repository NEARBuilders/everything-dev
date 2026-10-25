/**
 * The platform release manifest (ADR 0034) — one module, the whole release
 * contract: schema, composer, inventory, registry slot, resolution, and the
 * compat check. One composer feeds both publish homes (FastKV pointer slot +
 * in-image staging); the image digest is deliberately absent — it derives from
 * the tags at deploy preflight. The homes' one known divergence is the compat
 * floor: publisher-side (previous release) in FastKV, own version — failing
 * closed — in the image, which cannot read the registry inside the build.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Context, Layer } from "effect";
import {
  SHARED_DEP_SPECS,
  type SharedDependencyConfig,
  shareConfigFor,
} from "every-plugin/shared-deps-spec";
import { glob } from "glob";
import { z } from "zod";
import { getExtendsRef, parseBosRef } from "../../utils/bos-ref";
import { satisfiesConstraint } from "../federation/service";
import { fetchRegistryKey, fetchRegistryKeyOrNull } from "../registry/fastkv";
import { fetchParentConfig } from "../resolution/init-source";
import { AGENT_SYNC_GLOBS, FRAMEWORK_OWNED_SYNC_FILES } from "../scaffold/ownership";

export const PlatformReleaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("everything-dev/platform-manifest"),
  frameworkVersion: z.string().min(1),
  everyPluginVersion: z.string().min(1),
  /** The serving build's repo HEAD (full sha) — omitted when the compose
   * context has no git (regression image builds, build-arg-less builds). */
  gitSha: z.string().min(7).optional(),
  image: z.object({
    ref: z.string().min(1),
    tags: z.array(z.string().min(1)),
  }),
  catalog: z.record(z.string(), z.string()),
  sharedDeps: z.record(
    z.string(),
    z.object({
      version: z.string(),
      requiredVersion: z.union([z.string(), z.boolean()]),
      singleton: z.boolean(),
      eager: z.boolean(),
      strictVersion: z.boolean(),
      shareScope: z.string(),
    }),
  ),
  templateInventory: z.array(
    z.object({
      path: z.string(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
  compat: z.object({ minChild: z.string().min(1) }),
});
export type PlatformReleaseManifest = z.infer<typeof PlatformReleaseManifestSchema>;

export interface TemplateInventoryEntry {
  path: string;
  sha256: string;
}

export function getPlatformManifestKey(accountId: string, gatewayId: string): string {
  return `apps/${accountId}/${gatewayId}/platform.json`;
}

/** The immutable per-release slot (#573): one key per released framework
 * version, written once, never mutated — a divergent republish is a burned
 * version and fails loud. `platform.json` remains the moving pointer; slot-
 * first resolution (#574) reads slots directly. */
export function getPlatformVersionSlotKey(
  accountId: string,
  gatewayId: string,
  version: string,
): string {
  return `apps/${accountId}/${gatewayId}/platform-versions/${version}.json`;
}

/**
 * The template-source file set a release inventory hashes: the ownership
 * inventory's static paths, the agent-sync globs, and the per-plugin template
 * scaffolding (`plugins/_template/*` — the sources of the per-plugin sync
 * patterns). Files absent from the release source are skipped, mirroring
 * sync's transitional tolerance.
 */
const TEMPLATE_SCAFFOLD_SOURCES = [
  "plugins/_template/rspack.config.js",
  "plugins/_template/tsconfig.json",
  "plugins/_template/tests/types.d.ts",
];

function templateSourcePaths(sourceDir: string): string[] {
  const paths = new Set<string>([...FRAMEWORK_OWNED_SYNC_FILES, ...TEMPLATE_SCAFFOLD_SOURCES]);
  for (const match of glob.sync(AGENT_SYNC_GLOBS, {
    cwd: sourceDir,
    nodir: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.bos/**"],
  })) {
    paths.add(relative(sourceDir, join(sourceDir, match)));
  }
  return [...paths].sort();
}

export function computeTemplateInventory(sourceDir: string): TemplateInventoryEntry[] {
  const inventory: TemplateInventoryEntry[] = [];
  for (const relativeFilePath of templateSourcePaths(sourceDir)) {
    const fullPath = join(sourceDir, relativeFilePath);
    if (!existsSync(fullPath)) continue;
    try {
      const content = readFileSync(fullPath);
      inventory.push({
        path: relativeFilePath,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    } catch {
      // unreadable at compose time → not part of the release inventory
    }
  }
  return inventory.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function composeSharedDepsFromCatalog(
  catalog: Record<string, string>,
): Record<string, SharedDependencyConfig> {
  const deps: Record<string, SharedDependencyConfig> = {};
  for (const spec of SHARED_DEP_SPECS) {
    const version = catalog[spec.name];
    if (!version) continue;
    deps[spec.name] = { version, ...shareConfigFor(spec, version) };
  }
  return deps;
}

export interface ComposePlatformReleaseManifestInputs {
  frameworkVersion: string;
  everyPluginVersion: string;
  gitSha?: string;
  imageRef: string;
  catalog: Record<string, string>;
  templateInventory: TemplateInventoryEntry[];
  compatMinChild: string;
}

export function composePlatformReleaseManifest(
  inputs: ComposePlatformReleaseManifestInputs,
): PlatformReleaseManifest {
  // The manifest carries only the derivable tag — the exact version tag the
  // tag scheme pushes for semver releases (ADR 0021). Sha-tags are git facts
  // an image build cannot see; derivation (`ref@v<version>` → digest) keys off
  // the version tag so both publish homes stay byte-identical without any
  // build-context plumbing.
  const semver = parseSemver(inputs.frameworkVersion.trim());
  const tags = semver
    ? [
        `v${semver.major}.${semver.minor}.${semver.patch}${semver.prerelease ? `-${semver.prerelease}` : ""}`,
      ]
    : [];
  return PlatformReleaseManifestSchema.parse({
    schemaVersion: 1,
    kind: "everything-dev/platform-manifest",
    frameworkVersion: inputs.frameworkVersion,
    everyPluginVersion: inputs.everyPluginVersion,
    ...(inputs.gitSha ? { gitSha: inputs.gitSha } : {}),
    image: { ref: inputs.imageRef, tags },
    catalog: inputs.catalog,
    sharedDeps: composeSharedDepsFromCatalog(inputs.catalog),
    templateInventory: inputs.templateInventory,
    compat: { minChild: inputs.compatMinChild },
  });
}

/** The one serializer for both publish homes — byte-identical by construction. */
export function serializePlatformReleaseManifest(manifest: PlatformReleaseManifest): string {
  return JSON.stringify(manifest);
}

/**
 * The in-image copy (ADR 0034 pt 1): generated inside the docker build at
 * `packages/everything-dev/dist/platform-manifest.json`. Resolved relative to
 * this module — the compiled layout is `<pkg>/dist/services/platform/manifest.mjs`
 * (two directory levels up = `<pkg>/dist/`), the source layout is
 * `<pkg>/src/services/platform/manifest.ts` (four levels up = the pnpm parent
 * dir, then `<pkg>/dist/`). Both candidates are tried; absent or unparsable →
 * null.
 */
export function readInImagePlatformManifest(): PlatformReleaseManifest | null {
  const moduleFile = fileURLToPath(import.meta.url);
  const candidates = [
    join(moduleFile, "..", "..", "platform-manifest.json"),
    join(moduleFile, "..", "..", "..", "..", "dist", "platform-manifest.json"),
  ];
  for (const path of candidates) {
    try {
      return PlatformReleaseManifestSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
    } catch {
      // try the next layout candidate
    }
  }
  return null;
}

function parseSemver(
  version: string,
): { major: number; minor: number; patch: number; prerelease?: string } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] ? { prerelease: match[4] } : {}),
  };
}

function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return a === b ? 0 : a < b ? -1 : 1;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export interface PlatformCompatSubject {
  /** The child's recorded platform pin / installed framework version. */
  platformVersion?: string;
  catalog: Record<string, string>;
}

export interface PlatformCompatViolation {
  kind: "minChild" | "shared-dep";
  name?: string;
  message: string;
}

/**
 * The additive compat gate (ADR 0034 pt 5): the child's framework version must
 * sit inside the release's compat window, and strict singletons must agree
 * exactly with the release's pins. A sibling of the federation check — never
 * a relaxation of it.
 */
export function checkPlatformCompat(
  manifest: PlatformReleaseManifest,
  subject: PlatformCompatSubject,
): PlatformCompatViolation[] {
  const violations: PlatformCompatViolation[] = [];

  if (subject.platformVersion) {
    if (compareSemver(subject.platformVersion, manifest.compat.minChild) < 0) {
      violations.push({
        kind: "minChild",
        message: `platform ${subject.platformVersion} is older than this release's compat floor ${manifest.compat.minChild}`,
      });
    }
    if (compareSemver(subject.platformVersion, manifest.frameworkVersion) > 0) {
      violations.push({
        kind: "minChild",
        message: `platform ${subject.platformVersion} is newer than this release ${manifest.frameworkVersion}`,
      });
    }
  }

  for (const [name, pin] of Object.entries(manifest.sharedDeps)) {
    const childVersion = subject.catalog[name];
    if (pin.strictVersion) {
      if (!childVersion) {
        violations.push({
          kind: "shared-dep",
          name,
          message: `strict singleton "${name}" is missing from the child catalog (release pins ${pin.version})`,
        });
        continue;
      }
      if (childVersion !== pin.version) {
        violations.push({
          kind: "shared-dep",
          name,
          message: `strict singleton "${name}" is ${childVersion}, the release pins ${pin.version}`,
        });
      }
      continue;
    }
    if (typeof pin.requiredVersion === "string" && childVersion) {
      if (!satisfiesConstraint(childVersion, pin.requiredVersion)) {
        violations.push({
          kind: "shared-dep",
          name,
          message: `"${name}" is ${childVersion}, which does not satisfy the release range ${pin.requiredVersion}`,
        });
      }
    }
  }

  return violations;
}

/**
 * Resolution (ADR 0034 pt 3): one authored `platform` pin in, one resolved
 * manifest out. Absent pin = latest via extends (nearest chain manifest);
 * explicit pins match exactly or fail loud. The `.bos/platform-manifest.json`
 * cache carries offline dev; network failure with no usable cache → null
 * (today's behavior). All I/O is injectable — the test seam.
 */
export interface ResolvedPlatformManifest {
  manifest: PlatformReleaseManifest;
  source: { account: string; gateway: string };
  fromCache: boolean;
  /** Where the resolved bytes came from (#574): an immutable version slot
   * (an exact pin's target) or the moving `platform.json` pointer (unpinned
   * "latest" resolution). */
  provenance: "slot" | "pointer";
}

export interface PlatformManifestCache {
  schemaVersion: 1;
  kind: "everything-dev/platform-manifest-cache";
  resolvedAt: string;
  source: { account: string; gateway: string };
  manifest: PlatformReleaseManifest;
  provenance?: "slot" | "pointer";
}

/**
 * How long a cached resolution may stand in for a live fetch. The cache
 * exists for offline dev ONLY (#574) — never stale-pin grace: slot-first
 * resolution makes old pins resolvable forever from immutable slots, so a
 * cache can no longer be the reason a pin resolves. Without a freshness
 * bound a registry outage (or a cache written before the parent's latest
 * publish) silently serves a months-old release manifest — pins derive
 * from it and the mismatch can take an hour to diagnose. Past the TTL the
 * cache is refused: pin-less resolution degrades to "no manifest"; pinned
 * resolution fails loud with the slot key named.
 */
export const PLATFORM_MANIFEST_CACHE_TTL_MS = 24 * 60 * 60_000;

export interface ResolvePlatformManifestOptions {
  configDir: string;
  localConfig: Record<string, unknown>;
  fetchManifest?: (account: string, gateway: string) => Promise<PlatformReleaseManifest | null>;
  /** The immutable version-slot read (#574) — an exact pin's target. Throws
   * on read failure (distinct from a clean absent-slot null). */
  fetchSlot?: (account: string, gateway: string, version: string) => Promise<unknown>;
  fetchParent?: (account: string, gateway: string) => Promise<Record<string, unknown> | null>;
  cacheRead?: () => PlatformManifestCache | null;
  cacheWrite?: (cached: PlatformManifestCache) => void;
  /** injectable clock for the cache-freshness check (test seam) */
  now?: () => number;
  /** injectable freshness bound (test seam); defaults to {@link PLATFORM_MANIFEST_CACHE_TTL_MS} */
  cacheTtlMs?: number;
}

const CACHE_DIR = ".bos";
const CACHE_FILE = "platform-manifest.json";

/**
 * A cached resolution stands in for a live fetch only while it is fresh:
 * `resolvedAt` inside the TTL, and parseable (a cache with an unparseable
 * timestamp is treated as stale — never trusted).
 */
function isFresh(cached: PlatformManifestCache, opts: ResolvePlatformManifestOptions): boolean {
  const now = (opts.now ?? Date.now)();
  const ttl = opts.cacheTtlMs ?? PLATFORM_MANIFEST_CACHE_TTL_MS;
  const resolvedAt = Date.parse(cached.resolvedAt);
  if (Number.isNaN(resolvedAt)) return false;
  return now - resolvedAt <= ttl;
}

function defaultCachePath(configDir: string): string {
  return join(configDir, CACHE_DIR, CACHE_FILE);
}

function defaultCacheRead(configDir: string): PlatformManifestCache | null {
  try {
    const raw = JSON.parse(
      readFileSync(defaultCachePath(configDir), "utf-8"),
    ) as PlatformManifestCache;
    return raw?.kind === "everything-dev/platform-manifest-cache" ? raw : null;
  } catch {
    return null;
  }
}

function defaultCacheWrite(configDir: string, cached: PlatformManifestCache): void {
  try {
    mkdirSync(join(configDir, CACHE_DIR), { recursive: true });
    writeFileSync(defaultCachePath(configDir), `${JSON.stringify(cached, null, 2)}\n`);
  } catch {
    // cache writes never fail the resolution
  }
}

function defaultFetchManifest(
  account: string,
  gateway: string,
): Promise<PlatformReleaseManifest | null> {
  return (async () => {
    const raw = await fetchRegistryKeyOrNull<unknown>(account, gateway, "platform.json");
    if (!raw) return null;
    return PlatformReleaseManifestSchema.parse(raw);
  })();
}

function defaultFetchSlot(
  account: string,
  gateway: string,
  version: string,
): Promise<unknown | null> {
  // NOT the OrNull variant: a read failure must stay distinguishable from a
  // clean absent-slot — the resolver fails loud with the slot key on a
  // failure and treats null as absence.
  return fetchRegistryKey<unknown>(account, gateway, `platform-versions/${version}.json`);
}

function defaultFetchParent(
  account: string,
  gateway: string,
): Promise<Record<string, unknown> | null> {
  return fetchParentConfig(account, gateway)
    .then((config) => config as Record<string, unknown>)
    .catch(() => null);
}

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
 * The ONE extends-chain walk (child → root via FastKV parent configs): both
 * `resolvePlatformManifest` and the upgrade source resolution used to carry
 * their own `fetchParentConfig` loops; this is the shared implementation.
 * A fetch failure (throw or null) stops the walk — the chain gathered so far
 * is still returned.
 */
export async function walkExtendsChain(input: {
  localConfig: Record<string, unknown>;
  localRepository?: string;
  fetchParent?: (account: string, gateway: string) => Promise<Record<string, unknown> | null>;
}): Promise<ExtendsChainWalk> {
  const fetchParent = input.fetchParent ?? defaultFetchParent;
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

export async function resolvePlatformManifest(
  opts: ResolvePlatformManifestOptions,
): Promise<ResolvedPlatformManifest | null> {
  const fetchManifest =
    opts.fetchManifest ?? ((a: string, g: string) => defaultFetchManifest(a, g));
  const fetchSlot =
    opts.fetchSlot ?? ((a: string, g: string, v: string) => defaultFetchSlot(a, g, v));
  const cacheRead = opts.cacheRead ?? (() => defaultCacheRead(opts.configDir));
  const cacheWrite = opts.cacheWrite ?? ((cached) => defaultCacheWrite(opts.configDir, cached));

  const { chain } = await walkExtendsChain({
    localConfig: opts.localConfig,
    ...(opts.fetchParent ? { fetchParent: opts.fetchParent } : {}),
  });

  const writeCache = (
    manifest: PlatformReleaseManifest,
    source: { account: string; gateway: string },
    provenance: "slot" | "pointer",
  ) => {
    const cached: PlatformManifestCache = {
      schemaVersion: 1,
      kind: "everything-dev/platform-manifest-cache",
      resolvedAt: new Date().toISOString(),
      source,
      manifest,
      provenance,
    };
    cacheWrite(cached);
    return { manifest, source, fromCache: false, provenance };
  };

  const pin = typeof opts.localConfig.platform === "string" ? opts.localConfig.platform : undefined;

  // Slot-first pin resolution (#574): an exact pin targets the immutable
  // `platform-versions/<pin>.json` slot, scanning the extends chain — a root
  // release never strands a child pin, because slots are immutable and the
  // pointer only moves forward (the #546 stale-pin class is dead). The
  // pointer serves only unpinned ("latest") resolution.
  if (pin) {
    for (const node of chain) {
      const slotKey = getPlatformVersionSlotKey(node.account, node.gateway, pin);
      let raw: unknown;
      try {
        raw = await fetchSlot(node.account, node.gateway, pin);
      } catch (error) {
        // Slot read failure: the offline cache may stand in (an offline-dev
        // aid, not stale-pin grace — same pin match required) — otherwise
        // fail with the slot key named.
        const cached = cacheRead();
        if (cached && cached.manifest.frameworkVersion === pin && isFresh(cached, opts)) {
          return {
            manifest: cached.manifest,
            source: cached.source,
            fromCache: true,
            provenance: cached.provenance ?? "slot",
          };
        }
        throw new Error(
          `platform pin ${pin}: the version slot read failed (${slotKey}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (raw) {
        const manifest = PlatformReleaseManifestSchema.parse(raw);
        return writeCache(manifest, node, "slot");
      }
    }
    // Slot miss across the chain — the pin names a release whose manifest
    // leg never published (the npm-version-exists / manifest-not-published
    // race, #568). The old "pin not found, publish the release or clear the
    // pin" dead path is gone: slots are immutable, so this state means the
    // release deploy must be re-run.
    throw new Error(
      `platform pin ${pin}: no version slot in the extends chain` +
        `${chain.length > 0 ? ` (${chain.map((n) => `bos://${n.account}/${n.gateway}`).join(" → ")})` : ""} — ` +
        `the release's manifest leg never published it; re-run the release deploy (or \`bos upgrade\` to re-pin)`,
    );
  }

  for (const node of chain) {
    const manifest = await fetchManifest(node.account, node.gateway);
    if (!manifest) continue;
    return writeCache(manifest, node, "pointer");
  }

  const cached = cacheRead();
  if (cached && isFresh(cached, opts)) {
    return {
      manifest: cached.manifest,
      source: cached.source,
      fromCache: true,
      provenance: cached.provenance ?? "pointer",
    };
  }
  return null;
}

/**
 * The platform release manifest as a Context.Service: the same "module is
 * the implementation, the tag is the seam" shape as FastKVRegistryService —
 * CLI handlers `yield*` the tag; pure and standalone callers keep using the
 * plain functions. Tests provide `Layer.succeed` fakes instead of module
 * mocks.
 */
export class PlatformManifestService extends Context.Service<
  PlatformManifestService,
  {
    resolvePlatformManifest: typeof resolvePlatformManifest;
    composePlatformReleaseManifest: typeof composePlatformReleaseManifest;
    checkPlatformCompat: typeof checkPlatformCompat;
    readInImagePlatformManifest: typeof readInImagePlatformManifest;
  }
>()("everything-dev/platform/manifest") {
  static readonly Live = Layer.succeed(
    this,
    this.of({
      resolvePlatformManifest,
      composePlatformReleaseManifest,
      checkPlatformCompat,
      readInImagePlatformManifest,
    }),
  );
}
