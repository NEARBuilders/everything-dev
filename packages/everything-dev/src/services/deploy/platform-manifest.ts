/**
 * The deploy-side half of the platform release manifest (ADR 0034 pt 1/2):
 * wires the framework repo's release inputs into the pure composer and shapes
 * the registry entry that rides the train's atomic FastKV write. Framework-
 * rooted deploys only — a child deploy publishes no release manifest.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { compareSemver, satisfiesConstraint } from "../../utils/semver";
import {
  composePlatformReleaseManifest,
  computeTemplateInventory,
  type Manifest,
  type RemoteRecord,
  resolvePlatformManifest,
  serializePlatformReleaseManifest,
} from "../platform/manifest";
import { CUTOVER_RELEASE, manifestTagOf } from "../platform/manifest-schema";
import { getManifestKey, getVersionKey } from "../registry/pointer";
import { walkRemotes } from "../remotes";
import { readWorkspaceCatalog } from "../workspace/catalog";
import { readFrameworkVersion } from "./image";
import { computeSriHash } from "./integrity";

/** The universal image (ADR 0020/0021) — the release manifest's image ref. */
export const PLATFORM_IMAGE_REF = "ghcr.io/nearbuilders/everything-dev";

export interface ReleaseRemoteRef extends RemoteRecord {
  remote: string;
}

/**
 * The release's pinned remotes: every config remote (dotted config path, keyed by
 * the same path shape the release-remote stamping writes back — `app.auth`,
 * `app.auth.ui`, `plugins.votes.ui`, …) with a production URL and an
 * immutable version-manifest pin in the release's publish payload. The
 * release leg records them in the release manifest so pinned children can
 * re-point inherited remotes at these bytes.
 */
export function collectReleaseRemoteDigests(config: Record<string, unknown>): ReleaseRemoteRef[] {
  const remotes: ReleaseRemoteRef[] = [];
  walkRemotes(config, ({ remote, entry }) => {
    if (typeof entry !== "object" || entry === null) return;
    const base = typeof entry.production === "string" ? entry.production : undefined;
    const digest = entry.digest as { manifest?: unknown; integrity?: unknown } | undefined;
    const manifest = typeof digest?.manifest === "string" ? digest.manifest : undefined;
    const integrity = typeof digest?.integrity === "string" ? digest.integrity : undefined;
    if (base && manifest && integrity) {
      remotes.push({ remote, base, digest: { manifest, integrity } });
    }
  });
  return remotes;
}

/** The `Record<remote, RemoteRecord>` shape the manifest schema stores. */
export function releaseRemoteMap(config: Record<string, unknown>): Record<string, RemoteRecord> {
  return Object.fromEntries(
    collectReleaseRemoteDigests(config).map(({ remote, base, digest }) => [
      remote,
      { base, digest },
    ]),
  );
}

function readWorkspacePackageVersion(configDir: string, name: string): string | undefined {
  try {
    const raw = readFileSync(join(configDir, "packages", name, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

export function readEveryPluginVersion(configDir: string): string | undefined {
  return readWorkspacePackageVersion(configDir, "every-plugin");
}

const EXACT_SEMVER_SPEC = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const RANGE_SEMVER_SPEC = /^[\^~]\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Resolved versions from the workspace lockfile's importers — the versions the
 * release was actually built with. Importer entries carry peer suffixes
 * (`0.45.4(pg@8.23.1)`); the first importer (sorted key order) naming the
 * package wins, and only plain semver resolutions count (`link:` entries and
 * peer-suffixed garbage fall through). Unreadable lockfile → empty map: every
 * row then keeps its authored range, never a wrong exact pin.
 */
function readLockfileResolvedVersions(configDir: string): Map<string, string> {
  const lockPath = join(configDir, "pnpm-lock.yaml");
  if (!existsSync(lockPath)) return new Map();
  try {
    const lock = parseYaml(readFileSync(lockPath, "utf-8")) as {
      importers?: Record<
        string,
        {
          dependencies?: Record<string, { version?: string }>;
          devDependencies?: Record<string, { version?: string }>;
          optionalDependencies?: Record<string, { version?: string }>;
        }
      >;
    };
    const versions = new Map<string, string>();
    for (const importerKey of Object.keys(lock.importers ?? {}).sort()) {
      const importer = lock.importers?.[importerKey];
      if (!importer) continue;
      for (const field of [
        importer.dependencies,
        importer.devDependencies,
        importer.optionalDependencies,
      ]) {
        if (!field) continue;
        for (const [name, entry] of Object.entries(field)) {
          if (versions.has(name)) continue;
          const version = entry?.version?.split("(")[0] ?? "";
          if (EXACT_SEMVER_SPEC.test(version)) versions.set(name, version);
        }
      }
    }
    return versions;
  } catch {
    return new Map();
  }
}

/**
 * The release catalog with every row frozen to the exact version this release
 * was built with. Children install these rows verbatim (`syncRootCatalogWithParent`
 * → `pnpm install --force`), so a range row here floats the child's install past
 * the release its platform pin names — the mixed tree behind stale template bytes
 * failing against newer framework packages (the removed `drizzleCredentialsFor` /
 * `unwrapDatabaseError` breakage). Resolution order: a workspace package's own
 * version for rows naming local members (`workspace:^` consumers), the lockfile
 * resolution for range rows, and rows whose exact version is unknowable (git
 * specs, ranges missing from the lockfile) stay verbatim — a kept range satisfies
 * the truth gate's constraint check, a wrong exact pin would not.
 */
export function resolveExactCatalog(configDir: string): Record<string, string> {
  const catalog = readWorkspaceCatalog(configDir);
  const lockfile = readLockfileResolvedVersions(configDir);
  const resolved: Record<string, string> = {};
  for (const [name, spec] of Object.entries(catalog)) {
    const workspaceVersion = readWorkspacePackageVersion(configDir, name);
    if (workspaceVersion) {
      resolved[name] = workspaceVersion;
      continue;
    }
    if (EXACT_SEMVER_SPEC.test(spec) || !RANGE_SEMVER_SPEC.test(spec)) {
      resolved[name] = spec;
      continue;
    }
    resolved[name] = lockfile.get(name) ?? spec;
  }
  return resolved;
}

export interface PlatformManifestPublishHome {
  key: string;
  value: string;
  integrity: string;
}

export interface PlatformManifestPublishEntry {
  /** The thin tag at `manifest.json` — the moving pointer; its digest pins
   * the record's exact bytes. */
  tag: PlatformManifestPublishHome;
  /** The full manifest at `versions/<v>.json` — the immutable record. */
  record: PlatformManifestPublishHome;
  manifest: Manifest;
}

export function composePlatformManifestPublishEntry(opts: {
  configDir: string;
  account: string;
  gateway: string;
  /** The previous release's framework version — the compat floor it implies. */
  previousFrameworkVersion?: string;
  /** The deploy's repo HEAD — the serving build's identity on the wire. */
  gitSha?: string;
  imageRef?: string;
  /** The release's own publish payload — its pinned remotes ride the manifest
   * (ADR 0034 amendment: release-scoped extends inheritance). */
  publishPayload?: Record<string, unknown>;
}): PlatformManifestPublishEntry | null {
  const frameworkVersion = readFrameworkVersion(opts.configDir);
  const everyPluginVersion = readEveryPluginVersion(opts.configDir);
  if (!frameworkVersion || !everyPluginVersion) return null;

  // The compat floor never sits below the cutover release (ticket 10): a
  // pre-cutover child cannot parse the wire, so declaring it supported would
  // trade a resolution rejection for a confusing boot skew. Above the floor
  // keeps the rolling previous-release window.
  const previousFloor = opts.previousFrameworkVersion ?? frameworkVersion;
  const compatMinChild =
    compareSemver(CUTOVER_RELEASE, previousFloor) > 0 ? CUTOVER_RELEASE : previousFloor;

  const manifest = composePlatformReleaseManifest({
    frameworkVersion,
    everyPluginVersion,
    ...(opts.gitSha ? { gitSha: opts.gitSha } : {}),
    imageRef: opts.imageRef ?? PLATFORM_IMAGE_REF,
    catalog: resolveExactCatalog(opts.configDir),
    templateInventory: computeTemplateInventory(opts.configDir),
    compatMinChild,
    ...(opts.publishPayload ? { remotes: releaseRemoteMap(opts.publishPayload) } : {}),
  });
  const value = serializePlatformReleaseManifest(manifest);
  const tag = manifestTagOf(manifest, value);
  return {
    tag: {
      key: getManifestKey(opts.account, opts.gateway),
      value: JSON.stringify(tag),
      integrity: computeSriHash(JSON.stringify(tag)),
    },
    record: {
      key: getVersionKey(opts.account, opts.gateway, manifest.frameworkVersion),
      value,
      integrity: computeSriHash(value),
    },
    manifest,
  };
}

export interface DerivedImageRef {
  image: string;
  tag: string;
  digest?: string;
}

/**
 * The truth gate (#546): every uploaded workspace's version manifest declares
 * the shared-singleton versions its build embedded; the release manifest pins
 * the same names from the release catalog. A version that appears in both but
 * disagrees means the workspace's install drifted from the catalog — the
 * manifest would lie about the uploaded bytes and pinned children would boot
 * a skewed composition. Pin shapes mirror `checkPlatformCompat`'s semantics
 * (via `satisfiesConstraint`): an exact pin must match exactly, a range pin
 * must be satisfied by the built version — the catalog pinning every-plugin
 * as `^X` while bundles record the exact resolved version is not a violation.
 * Returns human-readable violations; empty = clean.
 */
export function platformTruthViolations(
  manifest: Manifest,
  sharedByWorkspace: Map<string, Record<string, string> | undefined>,
): string[] {
  const violations: string[] = [];
  for (const [workspace, shared] of sharedByWorkspace) {
    if (!shared) continue;
    for (const [name, version] of Object.entries(shared)) {
      const pin = manifest.sharedDeps[name];
      if (pin && !satisfiesConstraint(version, pin.version)) {
        violations.push(
          `${workspace} was built against ${name}@${version}, the release manifest pins ${pin.version} — ` +
            `a stale install publishes a manifest that lies about the uploaded bytes; ` +
            `run pnpm install and redeploy`,
        );
      }
    }
  }
  return violations;
}

/**
 * The compat-window freshness gate for **non-release** legs (#573-class):
 * when the pointer doesn't move, the pinned children keep resolving the
 * published manifest's `sharedDeps` — a chain that moved mid-version (a
 * catalog bump without a version bump) would land skew on every child while
 * every in-train version stamp agrees. Compares the embedded build versions
 * against the **published bytes** (not the composed manifest — on a release
 * leg the composed manifest IS the publish and needn't obey the old bytes).
 * Same `satisfiesConstraint` semantics as `platformTruthViolations`; absent
 * pins and unpinned names comparison is skipped. Returns human-readable
 * violations; empty = clean.
 */
export function compatWindowViolations(
  publishedSharedDeps: Record<string, { version: string }> | undefined,
  sharedByWorkspace: Map<string, Record<string, string> | undefined>,
): string[] {
  if (!publishedSharedDeps) return [];
  const violations: string[] = [];
  for (const [workspace, shared] of sharedByWorkspace) {
    if (!shared) continue;
    for (const [name, version] of Object.entries(shared)) {
      const pin = publishedSharedDeps[name];
      if (pin && !satisfiesConstraint(version, pin.version)) {
        violations.push(
          `${workspace} was built against ${name}@${version}, the pinned release manifest serves ${pin.version} — ` +
            `the compat window moved mid-version: commit a version PR so the release leg repins the window with the chain`,
        );
      }
    }
  }
  return violations;
}

/**
 * The derived-pin seam for image refs (ADR 0034 pt 2): when the platform
 * manifest resolves, a runtime's image ref derives as `ref@v<version>` —
 * never hand-pinned. Digest resolution rides the registry and arrives as
 * `digest` when the caller can fetch it; the deploy preflight consumer is
 * `resolveChildImagePin` (`services/deploy/legs.ts`), which resolves the
 * tag's digest and repoints the Railway service source.
 */
export async function deriveImageRefFromPlatformManifest(opts: {
  configDir: string;
  localConfig: Record<string, unknown>;
  fetchTag?: (account: string, gateway: string) => Promise<unknown>;
  fetchRecord?: (account: string, gateway: string, version: string) => Promise<unknown>;
  fetchParent?: (account: string, gateway: string) => Promise<Record<string, unknown> | null>;
}): Promise<DerivedImageRef | null> {
  const resolved = await resolvePlatformManifest({
    configDir: opts.configDir,
    localConfig: opts.localConfig,
    ...(opts.fetchTag ? { fetchTag: opts.fetchTag } : {}),
    ...(opts.fetchRecord ? { fetchRecord: opts.fetchRecord } : {}),
    ...(opts.fetchParent ? { fetchParent: opts.fetchParent } : {}),
  });
  if (!resolved) return null;
  const tag = resolved.manifest.image.tags[0];
  if (!tag) return null;
  return { image: resolved.manifest.image.ref, tag };
}
