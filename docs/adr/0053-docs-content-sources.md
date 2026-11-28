# 0053 — Docs content sources and the mount-qualified slug scheme

Date: 2026-11-27
Status: accepted
Implements: #444 (docs plugin), refines PR #450

## Context

The docs plugin (ADR-free until now) compiles the repository's markdown with Velite
at plugin build time and serves it read-only. That works while the plugin and the
content live in the same repo, but the goal is bigger: **the docs plugin is an
extension of the composing app** — whatever you put in `/docs` (your app's or a
plugin's) should surface under `/docs` when the plugin is added. Three design
questions follow:

1. Where does content come from — the plugin author's repo, or the composing app's?
2. How do multiple sources share one URL namespace without collisions?
3. What does the read API expose so UIs don't re-derive structure client-side?

## Decision

### One content plane: build-time compilation in the plugin's own workspace

Content truth stays **git in the repo that owns the docs plugin workspace**. Velite
compiles, during the plugin's rspack build, three sources relative to that repo's
root:

- the app's `docs/**` tree,
- the root `GLOSSARY.md`,
- every plugin's `plugins/<name>/docs/**` tree.

Each compiled record carries `source` (`app`, or the plugin's workspace name) and a
mount-qualified `slug`. A composing runtime that wants its own docs owns or
overrides the plugin workspace in its own repo — the same override mechanism every
plugin already has — and the deploy train recompiles on merge, exactly as UI
bundles recompile. **Composing-app content via config-declared sources and
uploaded content artifacts** was the deliberate non-goal here; ADR 0054 §3–§4
graduates it into a framework primitive (compiled collections ride the dist,
and a reader plugin consumes them through a `sources` variable). Boot-time disk
resolution stays rejected either way: it exists only where a repo checkout exists
(dev), so it would silently change behavior between dev and production.

### Mount-qualified slugs: `app` at the root, plugins under `plugins/<name>/…`

- App docs keep their path: `docs/adr/0012-x.md` → `adr/0012-x`, `GLOSSARY.md` →
  `glossary`.
- Plugin docs qualify under the source name: `plugins/auth/docs/install.md` →
  `plugins/auth/install`.

The slug **is** the public URL shape under `/docs` (`/docs/plugins/auth/install`),
which is also the nav-tree path — one scheme shared by URLs, slugs, and navigation.
A plugin ships its docs lane by adding a `docs/` folder to its workspace; no docs
plugin code changes.

**Namespace ownership:** each mounted plugin source owns its `plugins/<name>/…`
prefix. Where an app-authored page and a mounted plugin doc qualify to the same
slug, the plugin's own content shadows the app page — mirroring the composition
layer's shadowed-claims semantics. The app can still publish plugin-overview pages
elsewhere in its tree.

### The read API carries structure, not just pages

Three procedures (oRPC contract, REST + MCP surfaces follow automatically):

- `listPublished({ q?, tag?, source?, limit, cursor })` — `q` matches **body text**
  (velite flattens each doc into a `search` field: code fences and markdown syntax
  stripped), not just title/slug/description.
- `getBySlug({ slug })` — mount-qualified slug.
- `getNav()` — the **navigation tree**: one directory node per slug path segment,
  page nodes at the leaves. Directories sort by their subtree-minimum frontmatter
  `order`, so `order` lifts whole sections. UIs render this instead of re-deriving
  hierarchy from a flat list.
- `getBySlug({ slug })` resolves a **directory** URL to that directory's
  `README` page: `/docs/adr` is the ADR index, `/docs/plugins` the plugin-docs
  index. A directory is a destination, not a 404.

### The reader resolves links in corpus terms

Repository markdown links to itself as files — `./0002-x.md`,
`../plans/done/034-y.md`, `../../GLOSSARY.md`, `../adr/` — while the reader's
URLs are mount-qualified slugs. The renderer therefore rewrites in-corpus links
at render time: resolve the relative path against the current doc's slug, strip
`.md`/`.mdx`, map `GLOSSARY` to `glossary`, and route to `/docs/<slug>`.
External schemes, pure fragments, `/docs/` routes, and non-markdown assets pass
through untouched. Directory targets land on the README fallback above.

Rendering is client-side from raw markdown through one shared renderer (reader
and, later, a draft preview — parity by construction): `rehype-slug` ids back
the in-page TOC and deep links, and syntax highlighting runs on shiki's
JavaScript regex engine (no WASM) against a lazily built singleton with a fixed
common-language set. A leading `# Title` that restates the doc's title is
dropped, since the reader header already renders it.

## Consequences

- The UI renders a filesystem-hierarchy sidebar (shared nav tree), reader with
  breadcrumbs, in-page TOC, and heading anchors (rehype-slug ids matching the TOC).
- Loaders fetch through the router context's shared `apiClient.docs` seam — typed by
  the generated core contract on the client, in-process on SSR — so the docs pages
  hydrate without a client-only fetch flash.
- The corpus is bounded by what's on disk at build time; huge corpora would need the
  artifact-upload plane (the named follow-up), not bigger bundles.
- `docs/plugins/**` in the app tree collides with mounted plugin namespaces only
  when a plugin source of the same name exists; the shadowing rule decides
  deterministically.

## Alternatives considered

- **Config-declared sources resolved at plugin boot** — works only where the repo
  checkout exists (dev), silently degrading in production. Deferred until the
  deploy train grows a content-artifact leg.
- **Serving rendered HTML instead of raw markdown** — couples the API to the UI's
  rendering choices; the shared MarkdownRenderer contract (reader parity with a
  future draft-editor preview) requires raw markdown.
- **Per-plugin Velite collections** — dynamic collection definitions don't fit
  Velite's static config; a single collection with path-derived `source` does.
