import { readAuthoredConfigInput } from "../../config";
import { getExtendsRef, parseBosRef } from "../../utils/bos-ref";
import {
  type ResolvedPlatformManifest,
  resolvePlatformManifest,
  walkExtendsChain,
} from "../platform/manifest";
import { fetchParentConfig } from "./init";

export interface ExtendedRootSource {
  catalog: Record<string, string>;
  repository?: string;
  extendsChain: string[];
  /** The resolved platform release manifest when one publishes (ADR 0034). */
  platform: ResolvedPlatformManifest;
}

export async function readExtendedRootSource(projectDir: string): Promise<ExtendedRootSource> {
  const localConfig = (await readAuthoredConfigInput(projectDir)) as Record<string, unknown> | null;
  if (!localConfig) {
    throw new Error("No authored config found in current directory");
  }

  const extendsRef = getExtendsRef(localConfig);
  if (!extendsRef?.startsWith("bos://")) {
    throw new Error(
      "No bos:// extends field found in the authored config — upgrade moves children that extend a deployed runtime",
    );
  }

  const walk = await walkExtendsChain({
    localConfig,
    localRepository:
      typeof localConfig.repository === "string" ? localConfig.repository : undefined,
  });
  const extendsChain = walk.chain.map((node) => `bos://${node.account}/${node.gateway}`);
  if (walk.circularAt) {
    throw new Error(`Circular extends detected while resolving upgrade source: ${walk.circularAt}`);
  }

  // ADR 0034: the platform release manifest is the single upgrade authority —
  // its catalog and repository metadata. The upgrade-of-record resolves it
  // *ignoring the child's own platform pin*: the pin freezes everyday
  // resolution (sync, init, runtime); this is the pathway that moves the pin
  // to the latest chain release. No manifest anywhere → fail loud.
  const platform = await resolvePlatformManifest({
    configDir: projectDir,
    localConfig: { ...localConfig, platform: undefined },
  });
  if (!platform) {
    throw new Error(
      `No platform release manifest resolves in the extends chain (${extendsChain.join(" → ")}) — publish the platform manifest (bos publish on the parent) or run \`bos platform manifest --check\` to diagnose`,
    );
  }

  return {
    catalog: platform.manifest.catalog,
    repository: walk.repository,
    extendsChain,
    platform,
  };
}

export async function loadParentPluginOptions(projectDir: string): Promise<{
  localConfig: Record<string, unknown>;
  parentPlugins: Record<string, unknown>;
  newPluginKeys: string[];
} | null> {
  const localConfig = (await readAuthoredConfigInput(projectDir)) as Record<string, unknown> | null;
  if (!localConfig) {
    return null;
  }
  const extendsRef = getExtendsRef(localConfig);
  if (!extendsRef?.startsWith("bos://")) {
    return null;
  }

  const parsed = parseBosRef(extendsRef);
  if (!parsed) {
    return null;
  }

  let parentConfig: Record<string, unknown>;
  try {
    parentConfig = await fetchParentConfig(parsed.account, parsed.gateway);
  } catch {
    return null;
  }

  const parentPlugins =
    parentConfig.plugins && typeof parentConfig.plugins === "object"
      ? (parentConfig.plugins as Record<string, unknown>)
      : {};
  const localPlugins =
    localConfig.plugins && typeof localConfig.plugins === "object"
      ? (localConfig.plugins as Record<string, unknown>)
      : {};

  const newPluginKeys = Object.keys(parentPlugins).filter((key) => !(key in localPlugins));
  return { localConfig, parentPlugins, newPluginKeys };
}

function extractSemver(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

export function buildChangelogUrl(
  oldVersion: string | undefined,
  newVersion: string,
  repository: string | undefined,
): string | undefined {
  const fromVersion = extractSemver(oldVersion);
  const toVersion = extractSemver(newVersion);
  if (!fromVersion || !toVersion || fromVersion === toVersion) return undefined;

  const repoUrl = repository;
  if (!repoUrl) return undefined;

  const githubMatch = repoUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!githubMatch) return undefined;

  const [, owner, repo] = githubMatch;
  return `https://github.com/${owner}/${repo}/compare/v${fromVersion}...v${toVersion}`;
}
