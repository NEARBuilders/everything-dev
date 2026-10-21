/**
 * The deploy-side half of the platform release manifest (ADR 0034 pt 1/2):
 * wires the framework repo's release inputs into the pure composer and shapes
 * the registry entry that rides the train's atomic FastKV write. Framework-
 * rooted deploys only — a child deploy publishes no release manifest.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
 * The derived-pin seam for image refs (ADR 0034 pt 2): when the platform
 * manifest resolves, a runtime's image ref derives as `ref@v<version>` —
 * never hand-pinned. Digest resolution rides the registry and arrives as
 * `digest` when the caller can fetch it; the deploy preflight consumer is
 * follow-up work (plan 054 T4).
 */
export async function deriveImageRefFromPlatformManifest(opts: {
  configDir: string;
  localConfig: Record<string, unknown>;
  fetchManifest?: (account: string, gateway: string) => Promise<PlatformReleaseManifest | null>;
}): Promise<DerivedImageRef | null> {
  const resolved = await resolvePlatformManifest({
    configDir: opts.configDir,
    localConfig: opts.localConfig,
    fetchManifest: opts.fetchManifest,
  });
  if (!resolved) return null;
  const tag = resolved.manifest.image.tags[0];
  if (!tag) return null;
  return { image: resolved.manifest.image.ref, tag };
}
