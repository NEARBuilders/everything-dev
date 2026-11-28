const EXTERNAL_SCHEMES = /^[a-z][a-z0-9+.-]*:/i;

const splitHash = (href: string): { path: string; hash: string } => {
  const index = href.indexOf("#");
  if (index === -1) return { path: href, hash: "" };
  return { path: href.slice(0, index), hash: href.slice(index) };
};

const hasFileExtension = (basename: string): boolean => /\.[a-z0-9]+$/i.test(basename);

/**
 * Resolves an in-corpus markdown link to an app route under /docs.
 *
 * Repository markdown links to itself in file terms — `./other.md`,
 * `../plans/done/foo.md`, `../../GLOSSARY.md`, `../adr/` — which the reader
 * must map to its own slug scheme (the file's mount-qualified slug) instead
 * of letting the browser resolve them relative to the current URL. External
 * schemes (http, mailto, …), pure fragments, and non-markdown assets are
 * left alone; directory links land on the directory's README fallback.
 */
export function resolveDocHref(href: string, slug: string): string {
  if (!href || href.startsWith("#") || EXTERNAL_SCHEMES.test(href)) return href;
  if (href.startsWith("/docs/")) return href;

  const { path, hash } = splitHash(href);
  if (!path) return href;

  const isRooted = path.startsWith("/") || path.startsWith("docs/");
  const segments = isRooted ? [] : slug.split("/").slice(0, -1);
  const parts = path.split("/");
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const resolved = segments.join("/");
  const basename = resolved.split("/").at(-1) ?? "";
  if (hasFileExtension(basename) && !/\.(md|mdx)$/i.test(basename)) return href;
  const normalized = resolved.replace(/^docs\//, "");
  const withoutExtension = normalized.replace(/\.(md|mdx)$/i, "");
  const route = withoutExtension.endsWith("GLOSSARY") ? "glossary" : withoutExtension;
  return `/docs/${route}${hash}`;
}

/**
 * Drops a leading `# Title` heading when it restates the doc's title — the
 * reader's header already renders it, and a duplicated top heading reads
 * as an error rather than structure.
 */
export function dedupeLeadingTitle(raw: string, title: string): string {
  const match = /^\s*#\s+(.+?)\s*\r?\n/.exec(raw);
  if (!match) return raw;
  if (match[1]?.trim() !== title.trim()) return raw;
  return raw.slice(match[0].length);
}
