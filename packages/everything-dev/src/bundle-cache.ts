import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Bundle disk cache (ADR 0011 amendment — foreign-namespace resilience):
 * the child tier loads base workspaces from foreign origins; this cache
 * keeps the last-known-good bytes so an origin outage degrades to stale
 * serving instead of a hard failure. One cache root, two entrances: the
 * host's `/bundles/*` proxy handler (browser traffic) and the CLI fetch
 * adapter (boot-time outbound). Keyed exactly like the staged layout —
 * `<account>/<gateway>/<rest>` — but a separate root from BOS_BUNDLE_DIR:
 * cached bytes are a resilience artifact, never a deployment (plan 043 —
 * never point a runtime's BOS_BUNDLE_DIR at another runtime's layout).
 */

export function bundleCacheRoot(input?: { cacheDir?: string }): string {
  return path.resolve(input?.cacheDir ?? process.env.BOS_BUNDLE_CACHE_DIR ?? joinDefault());
}

function joinDefault(): string {
  return path.join(process.cwd(), ".bos", "bundle-cache");
}

export function bundleCachePath(url: string, input?: { cacheDir?: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const match = /^\/bundles\/([^/]+)\/([^/]+)\/(.+)$/.exec(parsed.pathname);
  if (!match) return null;
  const [, account, gateway, rest] = match;
  if (!rest || rest.endsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  const root = path.resolve(bundleCacheRoot(input));
  const filePath = path.resolve(root, account, gateway, decoded);
  if (!filePath.startsWith(root + path.sep)) return null;
  return filePath;
}

export async function readBundleCache(
  url: string,
  input?: { cacheDir?: string },
): Promise<Uint8Array | null> {
  const filePath = bundleCachePath(url, input);
  if (!filePath) return null;
  try {
    return new Uint8Array(await readFile(filePath));
  } catch {
    return null;
  }
}

export async function writeBundleCache(
  url: string,
  bytes: Uint8Array,
  input?: { cacheDir?: string },
): Promise<void> {
  const filePath = bundleCachePath(url, input);
  if (!filePath) return;
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, filePath);
  } catch {
    // cache writes are best-effort — never fail the serving path
  }
}
