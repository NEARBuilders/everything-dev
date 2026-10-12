import path from "node:path";

/**
 * Maps a bundle URL onto the staged namespace layout. Bundle URLs carry their
 * namespace in the path (`…/bundles/<account>/<gateway>/<workspace>/…`); the
 * staged layout mirrors it under `<bundleDir>/<account>/<gateway>/…`. The
 * namespace is taken from the URL itself — unlike the runtime-identity
 * resolution, this answers "which staged directory do these bytes live in?"
 * rather than "is this my namespace?" — and the result is contained within
 * the account/gateway directory. Returns null for foreign shapes.
 */
export function bundleUrlToStagedPath(url: string, bundleDir: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] !== "bundles" || segments.length < 3) return null;

  let decoded: string[];
  try {
    decoded = segments.slice(1).map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  const [account, gateway, ...rest] = decoded;
  if (!account || !gateway || rest.length === 0) return null;

  const nsDir = path.resolve(bundleDir, account, gateway);
  const filePath = path.resolve(nsDir, ...rest);
  if (filePath === nsDir || !filePath.startsWith(nsDir + path.sep)) return null;
  return filePath;
}

/** Resolve a relative config-supplied path inside `dir`, or null on escape. */
export function resolveContained(dir: string, relative: string): string | null {
  const resolved = path.resolve(dir, ...relative.split("/").filter(Boolean));
  if (resolved === dir || !resolved.startsWith(dir + path.sep)) return null;
  return resolved;
}
