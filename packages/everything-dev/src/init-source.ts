import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { execa } from "execa";
import { extract as tarExtract } from "tar";
import { findConfigPath, isAppDescriptorPath, loadAppDescriptorConfig } from "./config";
import { fetchResponse } from "./http-client";
import { fetchBosConfigFromFastKv } from "./services/registry/fastkv";
import { walkExtendsChain } from "./services/resolution/session";
import type { BosConfig } from "./types";
import { getExtendsRef, parseBosRef } from "./utils/bos-ref";
import { readWorkspaceCatalog } from "./workspace-catalog";

export { readWorkspaceCatalog };

export interface SourceResult {
  sourceDir: string;
  parentConfig: BosConfig;
  cleanup: () => Promise<void>;
}

export interface CatalogChainSource {
  catalog: Record<string, string>;
  repository?: string;
  extendsChain: string[];
}

export async function resolveCatalogChainSource(opts: {
  extendsAccount: string;
  extendsGateway: string;
  sourceDir?: string;
}): Promise<CatalogChainSource> {
  const entry = opts.sourceDir
    ? (findConfigPath(resolve(opts.sourceDir)) ?? join(resolve(opts.sourceDir), "bos.config.json"))
    : `bos://${opts.extendsAccount}/${opts.extendsGateway}`;
  const catalogs: Record<string, string>[] = [];
  const cleanups: Array<() => Promise<void>> = [];
  const resolvedRefs: string[] = [];
  let repository: string | undefined;

  try {
    await walkExtendsChain(entry, {
      env: "production",
      collectCatalogs: true,
      registerCleanup: (fn) => cleanups.push(fn),
      visit: async (link) => {
        resolvedRefs.unshift(
          link.ref.startsWith("bos://") ? link.ref : join(link.baseDir, basename(link.ref)),
        );
        catalogs.push(readWorkspaceCatalog(link.sourceDir ?? link.baseDir));
        const repositoryValue = (link.config as Record<string, unknown>).repository;
        if (typeof repositoryValue === "string" && repository === undefined) {
          repository = repositoryValue;
        }
      },
    });
  } finally {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }
  }

  return {
    catalog: Object.assign({}, ...catalogs),
    repository,
    extendsChain: opts.sourceDir
      ? [`bos://${opts.extendsAccount}/${opts.extendsGateway}`, ...resolvedRefs.slice(1)]
      : resolvedRefs,
  };
}

export async function resolveSourceDir(opts: {
  extendsAccount: string;
  extendsGateway: string;
  source?: string;
}): Promise<SourceResult> {
  if (opts.source) {
    const sourceDir = resolve(opts.source);
    const configPath = findConfigPath(sourceDir);
    if (!configPath) {
      throw new Error(
        `No authored config (bos.app.ts or bos.config.json) found in source directory: ${sourceDir}`,
      );
    }
    const parentConfig = isAppDescriptorPath(configPath)
      ? ((await loadAppDescriptorConfig(configPath)) as BosConfig)
      : (JSON.parse(readFileSync(configPath, "utf-8")) as BosConfig);
    return { sourceDir, parentConfig, cleanup: async () => {} };
  }

  const parentConfig = await fetchParentConfig(opts.extendsAccount, opts.extendsGateway);

  if (parentConfig.repository) {
    const { dir: sourceDir, cleanup } = await downloadTarball(parentConfig.repository);
    return { sourceDir, parentConfig, cleanup };
  }

  const chainResult = await resolveRepositoryViaExtendsChain(
    opts.extendsAccount,
    opts.extendsGateway,
  );
  if (chainResult?.repository) {
    const { dir: sourceDir, cleanup } = await downloadTarball(chainResult.repository);
    return { sourceDir, parentConfig: chainResult.config, cleanup };
  }

  return {
    sourceDir: "",
    parentConfig,
    cleanup: async () => {},
  };
}

export async function fetchParentConfig(
  extendsAccount: string,
  extendsGateway: string,
): Promise<BosConfig> {
  const bosUrl = `bos://${extendsAccount}/${extendsGateway}`;
  return fetchBosConfigFromFastKv<BosConfig>(bosUrl);
}

export async function resolveRepositoryViaExtendsChain(
  extendsAccount: string,
  extendsGateway: string,
  visited = new Set<string>(),
): Promise<{ repository: string; config: BosConfig } | null> {
  const key = `bos://${extendsAccount}/${extendsGateway}`;
  if (visited.has(key)) return null;
  visited.add(key);

  try {
    const config = await fetchParentConfig(extendsAccount, extendsGateway);
    if (config.repository) {
      return { repository: config.repository, config };
    }

    const extendsRef = getExtendsRef(config as Record<string, unknown>);
    if (extendsRef) {
      const normalized = extendsRef.startsWith("bos://") ? extendsRef : `bos://${extendsRef}`;
      const parsed = parseBosRef(normalized);
      if (parsed) {
        const result = await resolveRepositoryViaExtendsChain(
          parsed.account,
          parsed.gateway,
          visited,
        );
        if (result) return result;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function downloadTarball(
  repoUrl: string,
  ref?: string,
): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
  resolvedRef?: string;
  resolvedSha?: string;
}> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    throw new Error(`Cannot parse repository URL: ${repoUrl}`);
  }

  const { owner, repo } = parsed;
  let response: Response | null = null;
  let resolvedRef: string | undefined;

  const candidates = ref ? [ref] : ["main", "master"];
  for (const candidateRef of candidates) {
    const candidate = await fetchResponse(
      `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(candidateRef)}`,
      {
        headers: { "User-Agent": "everything-dev" },
        redirect: "follow",
        timeout: "60 seconds",
      },
    );
    if (candidate.ok) {
      response = candidate;
      resolvedRef = candidateRef;
      break;
    }
    if (candidate.status !== 404) {
      throw new Error(
        `GitHub tarball download failed: ${candidate.status} ${candidate.statusText}`,
      );
    }
  }

  if (!response) {
    throw new Error(
      ref
        ? `GitHub tarball download failed for ${repoUrl}: ref not found (${ref})`
        : `GitHub tarball download failed for ${repoUrl}: tried main and master`,
    );
  }

  if (!response.body) {
    throw new Error("GitHub tarball download returned empty body");
  }

  const resolvedSha = response.url.match(/\/([0-9a-f]{40})(?:\.tar\.gz)?\b/)?.[1];

  const tmpDir = mkTmpDir("bos-init-tarball-");
  const tarballPath = join(tmpDir, "source.tar.gz");

  const fileStream = createWriteStream(tarballPath);
  const reader = response.body as unknown as NodeJS.ReadableStream;
  await pipeline(reader, fileStream);

  const extractDir = mkTmpDir("bos-init-extract-");
  try {
    await tarExtract({ cwd: extractDir, file: tarballPath, strip: 1 });
  } catch {
    await execCommand("tar", ["-xzf", tarballPath, "--strip-components=1", "-C", extractDir]);
  }

  rmSync(tmpDir, { recursive: true, force: true });

  return {
    dir: extractDir,
    resolvedRef,
    resolvedSha,
    cleanup: async () => {
      rmSync(extractDir, { recursive: true, force: true });
    },
  };
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch?.[1] && sshMatch[2]) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

function mkTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}
async function execCommand(command: string, args: string[]): Promise<void> {
  await execa(command, args, { stdio: "pipe", timeout: 2 * 60_000 });
}
