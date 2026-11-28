export interface DocLinkContext {
  /** Slug of every page in the compiled corpus; unknown until the nav loads. */
  readonly slugs?: ReadonlySet<string>;
  /** The runtime's repository URL — where paths outside the corpus open. */
  readonly repository?: string;
}

export const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const GITHUB_REPOSITORY =
  /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/i;
const SKILL_FILE = /^packages\/([^/]+)\/skills\/(.+)$/;
const PUBLIC_ASSET = /^ui\/public\/(.+)$/;
export const DOCS_ROUTE_PREFIX = "/docs/";

const splitHash = (href: string): { path: string; hash: string } => {
  const index = href.indexOf("#");
  if (index === -1) return { path: href, hash: "" };
  return { path: href.slice(0, index), hash: href.slice(index) };
};

const hasFileExtension = (basename: string): boolean => /\.[a-z0-9]+$/i.test(basename);

/**
 * The reader route for a repository path — the compiler's slug derivation:
 * `docs/adr/0001-x.md` → `adr/0001-x`, and a plugin's `plugins/<name>/docs/x.md`
 * → `plugins/<name>/x`.
 */
export const routeOf = (repoPath: string): string => {
  const plugin = /^plugins\/([^/]+)\/docs\/(.+)$/.exec(repoPath);
  const within =
    plugin?.[1] && plugin[2]
      ? `plugins/${plugin[1]}/${plugin[2]}`
      : repoPath.replace(/^docs\//, "");
  const withoutExtension = within.replace(/\.(md|mdx)$/i, "");
  return withoutExtension.endsWith("GLOSSARY") ? "glossary" : withoutExtension;
};

const isCompiled = (route: string, isDirectory: boolean, slugs?: ReadonlySet<string>) => {
  if (!slugs) return true;
  if (slugs.has(route)) return true;
  return isDirectory && [...slugs].some((slug) => slug.startsWith(`${route}/`));
};

/**
 * Where a repository path opens when it is not a published document: the
 * runtime's repository, on its default branch, addressed as HEAD so no
 * branch name is guessed. Only GitHub-shaped repository URLs rewrite; any
 * other host leaves the link alone.
 */
export function repositoryUrl(
  repository: string | undefined,
  repoPath: string,
  isDirectory: boolean,
): string | undefined {
  if (!repository) return undefined;
  const match = GITHUB_REPOSITORY.exec(repository.trim());
  if (!match?.[1] || !match[2]) return undefined;
  const encoded = repoPath.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${match[1]}/${match[2]}/${isDirectory ? "tree" : "blob"}/HEAD/${encoded}`;
}

/**
 * Resolves a link authored as a repository path to where it opens in the
 * app.
 *
 * Repository markdown links in file terms — `./other.md`, `../plans/x.md`,
 * `../../GLOSSARY.md`, `../adr/` — so links resolve against the *document's
 * own file*, exactly as a repository host resolves them, and then route:
 *
 * - a package skill opens under /skills, where the UI build serves it;
 * - a public asset opens at the site root, where the UI build copies it;
 * - the root README is the About page;
 * - a document in the compiled corpus, or a directory that holds one, opens
 *   in the reader under /docs;
 * - anything else opens in the runtime's repository.
 *
 * The repository-only paths are matched first: none of them is ever a
 * compiled document, and the root README must not be mistaken for a page
 * whose slug is also `README`.
 *
 * External schemes and pure fragments are left alone.
 */
export function resolveDocHref(href: string, file: string, context: DocLinkContext = {}): string {
  if (!href || href.startsWith("#") || EXTERNAL_SCHEME.test(href)) return href;
  if (href.startsWith(DOCS_ROUTE_PREFIX)) return href;

  const { path, hash } = splitHash(href);
  if (!path) return href;

  const rooted = path.startsWith("/") || path.startsWith("docs/") || !file;
  const segments = rooted ? [] : file.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const resolved = segments.join("/");
  const isMarkdown = /\.(md|mdx)$/i.test(resolved);
  const isDirectory = !hasFileExtension(resolved.split("/").at(-1) ?? "");

  const skill = SKILL_FILE.exec(resolved);
  if (skill?.[1] && skill[2]) return `/skills/${skill[1]}/${skill[2]}${hash}`;

  const asset = PUBLIC_ASSET.exec(resolved);
  if (asset?.[1]) return `/${asset[1]}${hash}`;

  if (resolved === "README.md") return `/about${hash}`;

  if (isMarkdown || isDirectory) {
    const route = routeOf(resolved);
    if (isCompiled(route, isDirectory, context.slugs)) return `${DOCS_ROUTE_PREFIX}${route}${hash}`;
  }

  const repository = repositoryUrl(context.repository, resolved, isDirectory);
  if (repository) return `${repository}${hash}`;

  if (isMarkdown || isDirectory) return `${DOCS_ROUTE_PREFIX}${routeOf(resolved)}${hash}`;
  return href;
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
