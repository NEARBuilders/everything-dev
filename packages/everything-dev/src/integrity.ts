import { createHash } from "node:crypto";
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
  const attempts = 3;
  for (let attempt = 1; attempt < attempts; attempt++) {
    const hash = await computeSriHashOnce(url, options);
    if (hash) return hash;
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  return computeSriHashOnce(url, options);
}

async function computeSriHashOnce(url: string, options?: SriUrlOptions): Promise<string | null> {
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

export class SriVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SriVerificationError";
  }
}

export async function verifySriForUrl(
  url: string,
  expectedIntegrity: string,
  options?: SriUrlOptions,
): Promise<void> {
  const entryUrl = resolveSriTargetUrl(url, options);

  const response = await fetchResponse(entryUrl, { timeout: "30 seconds" });
  if (!response.ok) {
    throw new SriVerificationError(
      `Failed to fetch ${entryUrl} for verification: ${response.status}`,
    );
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

  for (const entry of [...Object.values(app ?? {}), ...Object.values(plugins ?? {})]) {
    if (!entry) continue;
    const slotHash = slotHashOf(entry);
    if (slotHash) hashes.set(slotHash.key, slotHash.hash);
  }

  return hashes;
}

/**
 * The integrity anchor a slot contributes to local↔chain attestation: pinned
 * slots anchor at the pinned manifest document (the pin's SRI), unpinned
 * slots at their fixed-name entry (the direct entry SRI).
 */
function slotHashOf(entry: Record<string, unknown>): { key: string; hash: string } | null {
  const production = entry.production;
  if (typeof production !== "string") return null;
  const pin = entry.pin as { manifest?: unknown; integrity?: unknown } | undefined;
  if (pin && typeof pin.manifest === "string" && typeof pin.integrity === "string") {
    return {
      key: `${production.replace(/\/$/, "")}/${pin.manifest.replace(/^\//, "")}`,
      hash: pin.integrity,
    };
  }
  if (typeof entry.integrity === "string") {
    return { key: resolveEntryUrl(production), hash: entry.integrity };
  }
  return null;
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
  /** A plain pipeline-state value (e.g. the built MF container name). */
  value?: string;
  valueField?: string;
  /** Dotted paths deleted after applying this entry — clears stale
   * pipeline-state fields (e.g. the retired flat `manifest` pointer). */
  removeFields?: string[];
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
    if (result.valueField && result.value !== undefined && result.value !== null) {
      setNestedPath(merged, result.valueField, result.value);
    }
    for (const field of result.removeFields ?? []) {
      deleteNestedPath(merged, field);
    }
  }
  return merged;
}
