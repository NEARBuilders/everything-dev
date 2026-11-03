import { readAuthoredConfigInput } from "../../config";
import { getExtendsRef, parseBosRef } from "../../utils/bos-ref";
import type { ResolvedPlatformManifest } from "../platform/manifest";
import {
  type ResolutionOutcome,
  type ResolutionSeams,
  resolveRelease,
  walkExtendsChain,
} from "../registry/resolution";
import { fetchParentConfig } from "./init";

export interface ExtendedRootSource {
  catalog: Record<string, string>;
  repository?: string;
  extendsChain: string[];
  /** The resolved platform release manifest when one publishes (ADR 0034). */
  platform: ResolvedPlatformManifest;
  /** The authored `release` as read from disk — the durable record of
   * the release the tree is aligned to. The manifest above is resolved
   * *ignoring* this field, so `authoredRelease !== platform.manifest.frameworkVersion`
   * is the pending-delta fact the migration phase is derived from; it needs
   * no flag carried across the re-exec boundary. */
  authoredRelease?: string;
}

/** Injectable registry I/O — partial overrides over the resolution machine's
 * production seams (the test seam). Cache reads are never overridable: the
 * upgrade-of-record refuses cache stand-ins when choosing a release. */
export type ExtendedRootSourceOptions = {
  fetchParent?: (account: string, gateway: string) => Promise<Record<string, unknown> | null>;
  seams?: Omit<Partial<ResolutionSeams>, "cacheRead">;
};

const neverCached = { state: "miss" as const };

function unresolvableError(outcome: Extract<ResolutionOutcome, { state: "Unresolved" }>): Error {
  const chain = outcome.context.chain.join(" → ");
  if (outcome.reason === "unreachable") {
    return new Error(
      `The registry is unreachable — cannot choose a release to stamp (${outcome.detail ?? "read failed"})` +
        `${chain ? ` — chain: ${chain}` : ""}. Retry when the registry is reachable.`,
    );
  }
  if (outcome.reason === "integrityFailure") {
    return new Error(
      `Refusing to choose a release: ${outcome.detail ?? "integrity check failed"}${chain ? ` — chain: ${chain}` : ""}`,
    );
  }
  return new Error(
    `No platform release manifest resolves in the extends chain (${chain || "empty"}) — publish the platform manifest (bos publish on the parent) or run \`bos platform manifest --check\` to diagnose` +
      (outcome.context.deadEnd
        ? `; the chain terminates at ${outcome.context.deadEnd.ref}${
            outcome.context.deadEnd.lastWrite
              ? ` (last write ${outcome.context.deadEnd.lastWrite})`
              : " which publishes no manifest legs"
          }`
        : ""),
  );
}

/**
 * The upgrade-of-record's release resolution: `Latest` over the extends
 * chain, read fresh — the offline cache may never choose the release this
 * upgrade stamps (a stale stand-in would pin children to bytes nobody
 * serves). The chosen release's immutable version record is verified before
 * returning, so the train fails loud BEFORE any mutation when a release
 * deployed with a missing manifest leg (the #568 class) instead of stranding
 * the tree mid-upgrade. Version records are immutable, so one verification
 * covers the whole run.
 */
export async function resolveLatestReleaseForUpgrade(input: {
  localConfig: Record<string, unknown>;
  localRepository?: string;
  configDir: string;
  options?: ExtendedRootSourceOptions;
}): Promise<ResolvedPlatformManifest> {
  const seams: Partial<ResolutionSeams> = {
    ...(input.options?.seams ?? {}),
    cacheRead: () => neverCached,
  };
  const common = {
    localConfig: input.localConfig,
    ...(input.localRepository !== undefined ? { localRepository: input.localRepository } : {}),
    configDir: input.configDir,
    seams,
    ...(input.options?.fetchParent ? { fetchParent: input.options.fetchParent } : {}),
  };

  const latest = await resolveRelease({ ...common, query: { kind: "Latest" } });
  if (latest.state === "Unresolved") throw unresolvableError(latest);

  // post-cutover the thin tag already carries (and verifies) the digest of
  // the record it names; the explicit verification is what guards the
  // pre-cutover full-manifest tag
  const release = latest.manifest.frameworkVersion;
  const record = await resolveRelease({ ...common, query: { kind: "Pinned", release } });
  if (record.state === "Unresolved") {
    const chain = record.context.chain.join(" → ");
    if (record.reason === "unreachable") {
      throw new Error(
        `The registry is unreachable — cannot verify release ${release}'s version record (${record.detail ?? "read failed"})` +
          `${chain ? ` — chain: ${chain}` : ""}. Retry when the registry is reachable.`,
      );
    }
    throw new Error(
      `Release ${release}'s version record is not published in the extends chain` +
        `${chain ? ` (${chain})` : ""} — the release deploy is incomplete or still running; ` +
        `retry once the release is fully published`,
    );
  }

  return {
    manifest: latest.manifest,
    source: latest.source,
    fromCache: false,
    provenance: latest.provenance,
  };
}

export async function readExtendedRootSource(
  projectDir: string,
  options: ExtendedRootSourceOptions = {},
): Promise<ExtendedRootSource> {
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
    ...(options.fetchParent ? { fetchParent: options.fetchParent } : {}),
  });
  const extendsChain = walk.chain.map((node) => `bos://${node.account}/${node.gateway}`);
  if (walk.circularAt) {
    throw new Error(`Circular extends detected while resolving upgrade source: ${walk.circularAt}`);
  }

  // ADR 0034: the platform release manifest is the single upgrade authority —
  // its catalog and repository metadata. The upgrade-of-record resolves it
  // *ignoring the child's own authored release*: the release freezes everyday
  // resolution (sync, init, runtime); this is the pathway that moves it to
  // the latest chain release. No manifest anywhere → fail loud.
  const platform = await resolveLatestReleaseForUpgrade({
    localConfig,
    localRepository:
      typeof localConfig.repository === "string" ? localConfig.repository : undefined,
    configDir: projectDir,
    options,
  });

  return {
    catalog: platform.manifest.catalog,
    repository: walk.repository,
    extendsChain,
    platform,
    ...(typeof localConfig.release === "string" ? { authoredRelease: localConfig.release } : {}),
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
