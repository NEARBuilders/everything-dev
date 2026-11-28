---
title: Docs plugin
description: The repository's own documentation, productized — docs-as-code with build-time compilation, per-plugin docs lanes, and gate-free reads
tags:
  - plugins
  - docs
order: 20
---

# Docs plugin

The docs plugin treats this repository's markdown as the product. There is no content
database and no publishing pipeline: the markdown in `docs/` (plus `GLOSSARY.md`, plus
each plugin's own `docs/` folder) is the single source of truth, compiled at build time
and served read-only.

The content **compilation** itself is framework-owned (ADR 0054): this workspace
declares its collections in `velite.config.ts`, and `every-plugin`'s build composition
compiles and watches them — no hand-written build integration. The compiled collections
also ride the plugin's dist as `content/<name>.json` artifacts, so the deploy train's
generic file machinery publishes them like any other asset. The plugin optionally
serves `sources` variables — published content artifact URLs — instead of its baked
bundle, which is how a composing runtime points the reader at its own content.

## How content flows

1. Edit markdown in the repository — the app's `docs/**` tree, `GLOSSARY.md`, or any
   plugin's `plugins/<name>/docs/**` tree — by hand or by an agent.
2. Merge to `main`. CI deploys; the deploy train rebuilds the plugin.
3. During the plugin's rspack build, the framework-owned content compiler
   (`every-plugin`'s `ContentCompilerPlugin`, auto-wired because this
   workspace declares `velite.config.ts`) runs
   [Velite](https://velite.js.org), compiling every matching file into typed
   JSON.
4. The compiled JSON is bundled into the plugin, emitted as a `content/docs.json`
   dist artifact, and served by the read API.

Content changes are versioned, reviewed, and audited in git — nothing else stores them.

## Content sources and slugs

Every compiled record carries its **source** (`app`, or a plugin's workspace name) and a
mount-qualified slug:

| File | Source | Slug |
| --- | --- | --- |
| `docs/adr/0012-foo.md` | `app` | `adr/0012-foo` |
| `GLOSSARY.md` | `app` | `glossary` |
| `plugins/auth/docs/install.md` | `auth` | `plugins/auth/install` |

The slug **is** the public URL shape under `/docs` (`/docs/plugins/auth/install`) and the
navigation tree's path — one scheme shared by URLs, slugs, and nav. A plugin ships its
docs lane by adding a `docs/` folder to its workspace; the docs plugin needs no changes.

Each mounted plugin source owns its `plugins/<name>/…` prefix: where an app-authored page
and a mounted plugin doc qualify to the same slug, the plugin's own content shadows the
app page (see [ADR 0053](../adr/0053-docs-content-sources.md)).

## Frontmatter

Every doc honors an optional frontmatter block:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `title` | string | first `#` heading, then the filename | Human title |
| `description` | string | — | Card copy on search results, head meta |
| `tags` | string[] | `[]` | Badge facet |
| `order` | number | `100` | Sort weight (lower first) — lifts whole directories by subtree minimum |

## Reading docs

Public, gate-free routes under the `public` mount:

- `/docs` — the index: the navigation tree (collapsible by directory) plus full-text
  search over title, slug, description, and **body text**
- `/docs/<slug>` — the reader: breadcrumbs, the rendered doc with heading anchors, an
  on-this-page TOC, and prev/next in tree order

A persistent sidebar shows the same nav tree on every docs page.

Programmatically, the same content is available to agents and tools:

- `listPublished({ q?, tag?, source?, limit, cursor })` — cursor-paginated; `q` matches
  body text, `source` filters by content source
- `getBySlug({ slug })` — a single doc's metadata and raw markdown body
- `getNav()` — the full navigation tree (directories by slug segment, ordered pages)

All three are exposed via oRPC (`/api/rpc/docs/…`), REST (`GET /api/docs/…`,
OpenAPI at `/api/spec.json`), and the MCP surface.

## Adding a doc

Create a markdown file anywhere under `docs/` (or under a plugin's `docs/` folder).
Frontmatter is optional — a file with just a heading is a valid doc:

```md
---
title: My feature
description: What it does
tags:
  - guides
order: 50
---

# My feature

...
```

Then merge to `main`; the doc goes live on the next deploy. To preview locally, run the
dev stack and open `/docs`.

## Adding the plugin to another runtime

Register it in the authored config beside the other plugins:

```ts
docs: Plugin("docs").path("plugins/docs", {
  name: "@everything-dev/docs-plugin",
  ui: { name: "docs-ui", path: "plugins/docs/ui" },
}),
```

The plugin declares no secrets and no database. Its velite config compiles the owning
repo's content sources (the patterns live in the plugin's `velite.config.ts`, relative to
that repo's root) — a runtime that wants its own docs owns or overrides the plugin
workspace in its own repo, and the deploy train recompiles on merge. Alternatively
(ADR 0054 §4), the runtime can leave the plugin remote-only and point the plugin's
`sources` variable at its own published content artifacts.
