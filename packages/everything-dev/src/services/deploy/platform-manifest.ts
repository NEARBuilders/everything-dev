/**
 * The deploy-side half of the platform release manifest (ADR 0034 pt 1/2):
 * wires the framework repo's release inputs into the pure composer and shapes
 * the registry entry that rides the train's atomic FastKV write. Framework-
 * rooted deploys only — a child deploy publishes no release manifest.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkspaceCatalog } from "../workspace/catalog";
import {
  composePlatformReleaseManifest,
  computeTemplateInventory,
  getPlatformManifestKey,
  serializePlatformReleaseManifest,
  type PlatformReleaseManifest,
} from "../platform/manifest";
import { computeSriHash } from "./integrity";
import { readFrameworkVersion } from "./image";

/** The universal image (ADR 0020/0021) — the release manifest's image ref. */
export const PLATFORM_IMAGE_REF = "ghcr.io/nearbuilders/everything-dev";

export function readEveryPluginVersion(configDir: string): string | undefined {
  try {
    const raw = readFileSync(join(configDir, "packages", "every-plugin", "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
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
  imageRef?: string;
}): PlatformManifestPublishEntry | null {
  const frameworkVersion = readFrameworkVersion(opts.configDir);
  const everyPluginVersion = readEveryPluginVersion(opts.configDir);
  if (!frameworkVersion || !everyPluginVersion) return null;

  const manifest = composePlatformReleaseManifest({
    frameworkVersion,
    everyPluginVersion,
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
