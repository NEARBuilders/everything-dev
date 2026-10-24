/**
 * The deploy-side half of the platform release manifest (ADR 0034 pt 1/2):
 * wires the framework repo's release inputs into the pure composer and shapes
 * the registry entry that rides the train's atomic FastKV write. Framework-
 * rooted deploys only — a child deploy publishes no release manifest.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { satisfiesConstraint } from "../federation/service";
import {
  composePlatformReleaseManifest,
  computeTemplateInventory,
  getPlatformManifestKey,
  type PlatformReleaseManifest,
  resolvePlatformManifest,
  serializePlatformReleaseManifest,
} from "../platform/manifest";
import { readWorkspaceCatalog } from "../workspace/catalog";
import { readFrameworkVersion } from "./image";
import { computeSriHash } from "./integrity";

/** The universal image (ADR 0020/0021) — the release manifest's image ref. */
export const PLATFORM_IMAGE_REF = "ghcr.io/nearbuilders/everything-dev";

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

export interface PlatformManifestPublishEntry {
  key: string;
  value: string;
  integrity: string;
  manifest: PlatformReleaseManifest;
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
}): PlatformManifestPublishEntry | null {
  const frameworkVersion = readFrameworkVersion(opts.configDir);
  const everyPluginVersion = readEveryPluginVersion(opts.configDir);
  if (!frameworkVersion || !everyPluginVersion) return null;

  const manifest = composePlatformReleaseManifest({
    frameworkVersion,
    everyPluginVersion,
    ...(opts.gitSha ? { gitSha: opts.gitSha } : {}),
    imageRef: opts.imageRef ?? PLATFORM_IMAGE_REF,
    catalog: readWorkspaceCatalog(opts.configDir),
    templateInventory: computeTemplateInventory(opts.configDir),
    compatMinChild: opts.previousFrameworkVersion ?? frameworkVersion,
  });
  const value = serializePlatformReleaseManifest(manifest);
  return {
    key: getPlatformManifestKey(opts.account, opts.gateway),
    value,
    integrity: computeSriHash(value),
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
  manifest: PlatformReleaseManifest,
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
  fetchManifest?: (account: string, gateway: string) => Promise<PlatformReleaseManifest | null>;
  fetchParent?: (account: string, gateway: string) => Promise<Record<string, unknown> | null>;
}): Promise<DerivedImageRef | null> {
  const resolved = await resolvePlatformManifest({
    configDir: opts.configDir,
    localConfig: opts.localConfig,
    fetchManifest: opts.fetchManifest,
    ...(opts.fetchParent ? { fetchParent: opts.fetchParent } : {}),
  });
  if (!resolved) return null;
  const tag = resolved.manifest.image.tags[0];
  if (!tag) return null;
  return { image: resolved.manifest.image.ref, tag };
}
