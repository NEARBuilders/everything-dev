import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBosConfigSource, stringifyBosConfig } from "./config-source";
import { fetchBosConfigFromFastKv } from "./fastkv";
import { fetchResponse } from "./http-client";

const DEFAULT_MAX_SRI_RESPONSE_BYTES = 20 * 1024 * 1024;

interface SriUrlOptions {
  resolveEntryUrl?: boolean;
  maxBytes?: number;
}

export function computeSriHash(content: string | Buffer): string {
  return `sha384-${createHash("sha384").update(content).digest("base64")}`;
}

function resolveSriTargetUrl(url: string, options?: SriUrlOptions): string {
  return options?.resolveEntryUrl === false ? url : resolveEntryUrl(url);
}

function getMaxSriResponseBytes(options?: SriUrlOptions): number {
  return options?.maxBytes ?? DEFAULT_MAX_SRI_RESPONSE_BYTES;
}

async function computeSriHashFromResponse(
  response: Response,
  url: string,
  options?: SriUrlOptions,
): Promise<string> {
  const maxBytes = getMaxSriResponseBytes(options);
  const contentLengthHeader = response.headers.get("content-length");

  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(
        `[SRI] Response for ${url} exceeds max size of ${maxBytes} bytes (${contentLength})`,
      );
    }
  }

  if (!response.body) {
    throw new Error(`[SRI] Missing response body for ${url}`);
  }

  const hash = createHash("sha384");
  const reader = response.body.getReader();
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(
        `[SRI] Response for ${url} exceeds max size of ${maxBytes} bytes (${totalBytes})`,
      );
    }

    hash.update(value);
  }

  return `sha384-${hash.digest("base64")}`;
}

export async function computeSriHashForUrl(
  url: string,
  options?: SriUrlOptions,
): Promise<string | null> {
  try {
    const entryUrl = resolveSriTargetUrl(url, options);

    const response = await fetchResponse(entryUrl, { timeout: "30 seconds" });
    if (!response.ok) {
      console.warn(`[SRI] Failed to fetch ${entryUrl}: ${response.status} ${response.statusText}`);
      return null;
    }
    return await computeSriHashFromResponse(response, entryUrl, options);
  } catch (error) {
    console.warn(
      `[SRI] Error computing integrity for ${url}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export function resolveEntryUrl(url: string): string {
  if (url.endsWith("/remoteEntry.js")) return url;
  if (url.endsWith("/mf-manifest.json"))
    return `${url.replace(/\/mf-manifest\.json$/, "")}/remoteEntry.js`;
  return `${url.replace(/\/$/, "")}/remoteEntry.js`;
}

export async function verifySriForUrl(
  url: string,
  expectedIntegrity: string,
  options?: SriUrlOptions,
): Promise<void> {
  const entryUrl = resolveSriTargetUrl(url, options);

  const response = await fetchResponse(entryUrl, { timeout: "30 seconds" });
  if (!response.ok) {
    console.warn(`[SRI] Failed to fetch ${entryUrl} for verification: ${response.status}`);
    return;
  }

  const computed = await computeSriHashFromResponse(response, entryUrl, options);

  if (computed !== expectedIntegrity) {
    throw new Error(
      `[SRI] Integrity check failed for ${entryUrl}\n  Expected: ${expectedIntegrity}\n  Computed: ${computed}`,
    );
  }
}

export class IntegrityRegistry {
  private hashes = new Map<string, string>();

  register(url: string, integrity: string): void {
    this.hashes.set(url, integrity);
  }

  registerEntry(baseUrl: string, integrity: string): void {
    this.hashes.set(resolveEntryUrl(baseUrl), integrity);
  }

  get(url: string): string | undefined {
    return this.hashes.get(url);
  }

  has(url: string): boolean {
    return this.hashes.has(url);
  }

  entries(): IterableIterator<[string, string]> {
    return this.hashes.entries();
  }
}

function extractIntegrityHashes(config: Record<string, unknown>): Map<string, string> {
  const hashes = new Map<string, string>();
  const app = config.app as Record<string, Record<string, unknown>> | undefined;
  const plugins = config.plugins as Record<string, Record<string, unknown>> | undefined;

  if (app) {
    for (const [, entry] of Object.entries(app)) {
      if (entry?.integrity && entry?.production) {
        hashes.set(resolveEntryUrl(entry.production as string), entry.integrity as string);
      }
    }
  }

  if (plugins) {
    for (const [, entry] of Object.entries(plugins)) {
      if (entry?.integrity && entry?.production) {
        hashes.set(resolveEntryUrl(entry.production as string), entry.integrity as string);
      }
    }
  }

  return hashes;
}

export async function verifyConfigAgainstChain(
  localConfig: Record<string, unknown>,
  bosUrl: string,
): Promise<{ verified: boolean; mismatches: string[] }> {
  const mismatches: string[] = [];

  let chainConfig: Record<string, unknown>;
  try {
    chainConfig = await fetchBosConfigFromFastKv<Record<string, unknown>>(bosUrl);
  } catch (error) {
    console.warn(
      `[Attestation] Failed to fetch on-chain config: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { verified: false, mismatches: ["chain-fetch-failed"] };
  }

  const localHashes = extractIntegrityHashes(localConfig);
  const chainHashes = extractIntegrityHashes(chainConfig);

  for (const [url, chainHash] of chainHashes) {
    const localHash = localHashes.get(url);
    if (localHash && localHash !== chainHash) {
      mismatches.push(url);
      console.error(
        `[Attestation] Integrity mismatch for ${url}\n  Local: ${localHash}\n  Chain: ${chainHash}`,
      );
    }
  }

  if (mismatches.length === 0 && localHashes.size > 0) {
    console.log(
      `[Attestation] Local config verified against on-chain anchor (${localHashes.size} entries checked)`,
    );
  }

  return { verified: mismatches.length === 0, mismatches };
}

export interface DeployResultEntry {
  url: string;
  integrity?: string;
  urlField: string;
  integrityField?: string;
}

function setNestedPath(obj: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const keys = dottedPath.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]!;
    if (current[key] === undefined || current[key] === null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]!] = value;
}

function deleteNestedPath(obj: Record<string, unknown>, dottedPath: string): void {
  const keys = dottedPath.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]!;
    if (current[key] === undefined || typeof current[key] !== "object") return;
    current = current[key] as Record<string, unknown>;
  }
  delete current[keys[keys.length - 1]!];
}

export function reportDeployResult(opts: {
  url: string;
  integrity?: string | null;
  bosConfigPath: string;
  urlField: string;
  integrityField?: string;
}): void {
  console.log(
    `[BOS_DEPLOY] url=${opts.url} urlField=${opts.urlField} integrityField=${opts.integrityField ?? ""} integrity=${opts.integrity ?? ""}`,
  );

  try {
    const isToml = opts.bosConfigPath.endsWith(".toml");
    const config = readBosConfigSource(opts.bosConfigPath) as Record<string, unknown>;
    setNestedPath(config, opts.urlField, opts.url);
    if (opts.integrityField) {
      if (opts.integrity) {
        setNestedPath(config, opts.integrityField, opts.integrity);
      } else {
        deleteNestedPath(config, opts.integrityField);
      }
    }
    const content = isToml
      ? `${stringifyBosConfig(config)}\n`
      : `${JSON.stringify(config, null, 2)}\n`;
    writeFileSync(opts.bosConfigPath, content);
    const label = isToml ? "bos.config.toml" : "bos.config.json";
    console.log(`   ✅ Updated ${label}: ${opts.urlField}`);
    if (opts.integrityField && opts.integrity) {
      console.log(`   ✅ Updated ${label}: ${opts.integrityField}`);
    }
  } catch (err) {
    const label = opts.bosConfigPath.endsWith(".toml") ? "bos.config.toml" : "bos.config.json";
    console.error(`   ❌ Failed to update ${label}:`, (err as Error).message);
  }
}

export function parseDeployLines(output: string): DeployResultEntry[] {
  const results: DeployResultEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.includes("[BOS_DEPLOY]")) continue;
    const urlMatch = line.match(/url=(\S+)/);
    const urlFieldMatch = line.match(/urlField=(\S+)/);
    if (!urlMatch || !urlFieldMatch) continue;
    const integrityFieldMatch = line.match(/integrityField=(\S+)/);
    const integrityMatch = line.match(/integrity=(\S+)/);
    results.push({
      url: urlMatch[1],
      urlField: urlFieldMatch[1],
      integrityField: integrityFieldMatch?.[1] || undefined,
      integrity: integrityMatch?.[1] || undefined,
    });
  }
  return results;
}

export function applyDeployResults(
  config: Record<string, unknown>,
  results: DeployResultEntry[],
): Record<string, unknown> {
  const merged = structuredClone(config);
  for (const result of results) {
    setNestedPath(merged, result.urlField, result.url);
    if (result.integrityField) {
      if (result.integrity) {
        setNestedPath(merged, result.integrityField, result.integrity);
      } else {
        deleteNestedPath(merged, result.integrityField);
      }
    }
  }
  return merged;
}

export function findPluginKey(bosConfigPath: string, pluginDir: string): string | null {
  const config = readBosConfigSource(bosConfigPath) as Record<string, unknown>;
  const plugins = config.plugins as Record<string, Record<string, unknown>> | undefined;
  if (!plugins) return null;
  const configRoot = join(bosConfigPath, "..");
  const normalizedPluginDir = pluginDir.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const [key, plugin] of Object.entries(plugins)) {
    const dev = plugin?.development;
    if (typeof dev !== "string" || !dev.startsWith("local:")) continue;
    const resolved = join(configRoot, dev.slice("local:".length))
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
    if (resolved === normalizedPluginDir) return key;
  }
  return null;
}
