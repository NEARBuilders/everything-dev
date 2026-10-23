---
title: Docs plugin
description: The repository's own documentation, productized — docs-as-code with build-time compilation and gate-free reads
tags:
  - plugins
  - docs
order: 20
---

# Docs plugin

The docs plugin treats this repository's markdown as the product. There is no content
database and no publishing pipeline: the markdown in `docs/` (plus `GLOSSARY.md`) is the
single source of truth, compiled at build time and served read-only.

## How content flows

1. Edit markdown in the repository (`docs/**` or `GLOSSARY.md`) — by hand or by an agent.
2. Merge to `main`. CI deploys; the deploy train rebuilds the plugin.
3. During the plugin's rspack build, a `beforeCompile` hook runs
   [Velite](https://velite.js.org), which compiles every matching file into typed JSON.
4. The compiled JSON is bundled into the plugin, and the read API serves it.

Content changes are versioned, reviewed, and audited in git — nothing else stores them.

## Frontmatter

Every doc honors an optional frontmatter block:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `title` | string | first `#` heading, then the filename | Human title |
| `description` | string | — | Card copy on the index |
| `tags` | string[] | `[]` | Filter facet |
| `order` | number | `100` | Sort weight (lower first) |

Slugs are path-derived: `docs/adr/0012-foo.md` → `adr/0012-foo`, `GLOSSARY.md` →
`glossary`.

## Reading docs

Public, gate-free routes under the `public` mount:

- `/docs` — the index: every compiled doc as a card (title, description, tag chips)
- `/docs/<slug>` — a rendered doc

The API supports query/tag filtering and cursor pagination (`listPublished`); the v1
index renders the full list and doesn't expose filter inputs yet.

Programmatically, the same content is available to agents and tools:

- REST: `GET /api/rpc/docs/listPublished?q=&tag=&limit=&cursor=` and
  `GET /api/rpc/docs/getBySlug?slug=<slug>` (OpenAPI: `/api/spec.json`)
- MCP: the same operations appear as generated tools on the MCP surface

## Adding a doc

Create a markdown file anywhere under `docs/` (or edit an existing one). Frontmatter is
optional — a file with just a heading is a valid doc:

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

The plugin declares no secrets and no database. Its velite config currently compiles the
root runtime's `docs/` tree (the pattern is authored in the plugin's `velite.config.ts`);
a child runtime can edit that file to point at its own content directory.
