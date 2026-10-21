/**
 * The platform release manifest (ADR 0034) — one module, the whole release
 * contract: schema, composer, inventory, registry slot, and the compat check.
 * One composer feeds both publish homes (FastKV pointer slot + in-image
 * staging) so their bytes are identical by construction; the image digest is
 * deliberately absent — it derives from the tags at deploy preflight.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { glob } from "glob";
import { z } from "zod";
import {
  type SharedDependencyConfig,
  SHARED_DEP_SPECS,
  shareConfigFor,
} from "every-plugin/shared-deps-spec";
import { satisfiesConstraint } from "../federation/service";
import { AGENT_SYNC_GLOBS, FRAMEWORK_OWNED_SYNC_FILES } from "../scaffold/ownership";
import { fetchParentConfig } from "../resolution/init-source";
import { getExtendsRef, parseBosRef } from "../../utils/bos-ref";
import { fetchRegistryKeyOrNull } from "../registry/fastkv";

export const PlatformReleaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("everything-dev/platform-manifest"),
  frameworkVersion: z.string().min(1),
  everyPluginVersion: z.string().min(1),
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
  const semver = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(
    inputs.frameworkVersion.trim(),
  );
  const tags = semver ? [`v${semver[1]}.${semver[2]}.${semver[3]}${semver[4] ? `-${semver[4]}` : ""}`] : [];
  return PlatformReleaseManifestSchema.parse({
    schemaVersion: 1,
    kind: "everything-dev/platform-manifest",
    frameworkVersion: inputs.frameworkVersion,
    everyPluginVersion: inputs.everyPluginVersion,
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

function parseSemver(
  version: string,
): { major: number; minor: number; patch: number } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
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
}

export interface PlatformManifestCache {
  schemaVersion: 1;
  kind: "everything-dev/platform-manifest-cache";
  resolvedAt: string;
  source: { account: string; gateway: string };
  manifest: PlatformReleaseManifest;
}

export interface ResolvePlatformManifestOptions {
  configDir: string;
  localConfig: Record<string, unknown>;
  fetchManifest?: (account: string, gateway: string) => Promise<PlatformReleaseManifest | null>;
  fetchParent?: (account: string, gateway: string) => Promise<Record<string, unknown> | null>;
  cacheRead?: () => PlatformManifestCache | null;
  cacheWrite?: (cached: PlatformManifestCache) => void;
}

const CACHE_DIR = ".bos";
const CACHE_FILE = "platform-manifest.json";

function defaultCachePath(configDir: string): string {
  return join(configDir, CACHE_DIR, CACHE_FILE);
}

function defaultCacheRead(configDir: string): PlatformManifestCache | null {
  try {
    const raw = JSON.parse(readFileSync(defaultCachePath(configDir), "utf-8")) as PlatformManifestCache;
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

function defaultFetchManifest(account: string, gateway: string): Promise<PlatformReleaseManifest | null> {
  return (async () => {
    const raw = await fetchRegistryKeyOrNull<unknown>(account, gateway, "platform.json");
    if (!raw) return null;
    return PlatformReleaseManifestSchema.parse(raw);
  })();
}

function defaultFetchParent(account: string, gateway: string): Promise<Record<string, unknown> | null> {
  return fetchParentConfig(account, gateway)
    .then((config) => config as Record<string, unknown>)
    .catch(() => null);
}

export async function resolvePlatformManifest(
  opts: ResolvePlatformManifestOptions,
): Promise<ResolvedPlatformManifest | null> {
  const fetchManifest =
    opts.fetchManifest ?? ((a: string, g: string) => defaultFetchManifest(a, g));
  const fetchParent = opts.fetchParent ?? defaultFetchParent;
  const cacheRead =
    opts.cacheRead ?? (() => defaultCacheRead(opts.configDir));
  const cacheWrite =
    opts.cacheWrite ?? ((cached) => defaultCacheWrite(opts.configDir, cached));

  // Walk the extends chain child → root, mirroring upgrade's chain walk.
  const chain: Array<{ account: string; gateway: string }> = [];
  const visited = new Set<string>();
  let cursor: { account: string; gateway: string } | null = null;
  const extendsRef = getExtendsRef(opts.localConfig);
  if (typeof extendsRef === "string" && extendsRef.startsWith("bos://")) {
    const parsed = parseBosRef(extendsRef);
    if (parsed) cursor = { account: parsed.account, gateway: parsed.gateway };
  }
  while (cursor && !visited.has(`bos://${cursor.account}/${cursor.gateway}`)) {
    visited.add(`bos://${cursor.account}/${cursor.gateway}`);
    chain.push(cursor);
    const parentConfig = await fetchParent(cursor.account, cursor.gateway);
    if (!parentConfig) break;
    const nextRef = getExtendsRef(parentConfig);
    if (typeof nextRef !== "string" || !nextRef.startsWith("bos://")) break;
    const parsed = parseBosRef(nextRef);
    if (!parsed) break;
    cursor = { account: parsed.account, gateway: parsed.gateway };
  }

  const writeCache = (manifest: PlatformReleaseManifest, source: { account: string; gateway: string }) => {
    const cached: PlatformManifestCache = {
      schemaVersion: 1,
      kind: "everything-dev/platform-manifest-cache",
      resolvedAt: new Date().toISOString(),
      source,
      manifest,
    };
    cacheWrite(cached);
    return { manifest, source, fromCache: false };
  };

  const pin = typeof opts.localConfig.platform === "string" ? opts.localConfig.platform : undefined;

  for (const node of chain) {
    const manifest = await fetchManifest(node.account, node.gateway);
    if (!manifest) continue;
    if (!pin) return writeCache(manifest, node);
    if (manifest.frameworkVersion === pin) return writeCache(manifest, node);
  }

  const cached = cacheRead();
  if (cached && (!pin || cached.manifest.frameworkVersion === pin)) {
    return { manifest: cached.manifest, source: cached.source, fromCache: true };
  }

  if (pin) {
    throw new Error(
      `platform pin ${pin} not found in the extends chain${chain.length > 0 ? ` (${chain.map((n) => `bos://${n.account}/${n.gateway}`).join(" → ")})` : ""} — publish the release or clear the pin`,
    );
  }
  return null;
}
