---
title: "04 · Composition"
description: How independently deployed UIs and plugins become one app — remotes, mounts, route manifests, precedence, shared singletons, typed clients, and content.
order: 40
tags:
  - book
---

# 04 · Composition

Composition is how separately built and separately deployed pieces become one app at
boot. The pieces never import each other at build time and never see each other's
objects at runtime; they exchange **data** — manifests and contracts — and the host
does the assembling.

## Remotes

A **remote** is a named position in the composition — `app.ui`, `app.api`,
`app.auth`, `plugins.<id>`, `plugins.<id>.ui` — and, loosely, the workspace whose
bytes fill it. In production every remote pins an immutable version manifest
(`{ production, pin }`); the config's SRI on that manifest is what makes a swap
atomic. A remote can be:

- **local** — a workspace in this repository (`local:` path);
- **published** — another runtime's remote, inherited through `extends`;
- **call-only** — a `proxy` endpoint plus a contract locator, consumed as a typed
  client without loading any bundle.

## UI composition

A plugin's entire authoring surface is **ordinary TanStack route files**. There is no
hand-written tree and no manifest to maintain. The build derives three artifacts from
the files:

| Artifact | What it is | Used by |
|---|---|---|
| `routeTree.gen.ts` | The plugin's own route tree | Local dev and typecheck — stock TanStack DX |
| `manifest.gen.json` | Pure data: route ids, paths, nesting, mount, file refs | The host, when it builds the tree |
| `route-config.gen.ts` | An import map of real functions — loaders, guards, heads, components | The host, once at boot |

**The host owns the route graph.** It constructs its *own* route objects from every
remote's manifest, through public router APIs, and parents them into one tree. No
route object ever crosses a bundle boundary, so no plugin can break the tree by
being built against a different router version. ([ADR 0008](../adr/0008-manifest-composition.md))

### Mounts are gates

A mount is a pathless layout position declared by a root-level `_`-prefixed route
file. It carries a gate and nothing else — no chrome, no product shape:

| Mount | Gate | Routes |
|---|---|---|
| `_public` | None | Landing, login, docs, any plugin's public pages |
| `_authenticated` | Session | Dashboards, settings |
| `_admin` | Admin role | Platform administration |

Guards are ordinary `beforeLoad`s supplied by the composing framework, so the
composition engine itself knows nothing about auth — and a plugin cannot ship a route
that escapes its mount's gate, because it never constructs the route.

### Lazy by construction

Each route splits into eager **meta** — search validation, guards, head, nav — and a
lazy **component**. The server loads meta once per composed generation; the browser
downloads a component only when its route matches. First paint does not pay for every
plugin's pages. ([ADR 0024](../adr/0024-composition-stays-manifest-based.md))

The sidebar is route-aware too: a nav entry declared through `staticData.nav` appears
only when a route that owns it is actually composed.

### When things disagree

| Situation | Outcome |
|---|---|
| The core UI and a plugin claim the same path | The core UI wins; the plugin's claim is shadowed and logged |
| Two plugins claim the same path | A loud config error naming both — never a silent winner |
| A published plugin remote fails to load | That source is dropped with a warning; the healthy subset is served |
| A local source or the core UI fails to load | The composition fails loudly — never a silently degraded app |

**Local over plugin is override by design.** An app replaces a plugin's page by
defining the same path in its own UI — the whole tenant-customization model in one
rule. ([ADR 0010](../adr/0010-composition-contracts-kit-and-precedence.md))

## Shared singletons

Every UI remote negotiates one copy of each shared dependency with the page:

| List | Members |
|---|---|
| UI remotes | `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `@lingui/*`, `everything-dev/ui/auth`, `everything-dev/ui/i18n` — strict; `sonner` — tolerant |
| Backend remotes | `every-plugin`, `effect`, `@orpc/*` — strict; `zod` — tolerant |

Two copies of React crash with "Invalid hook call"; two copies of the session
module disagree into redirect loops. **Critical** entries are exact-version
singletons with no bundled fallback — a mismatch fails loudly
(`SharedSingletonSkewError`, and `bos mf check` before that). **Tolerant** entries
keep a fallback so old and new remotes can coexist during a rollout.
([ADR 0018](../adr/0018-session-single-owner.md),
[ADR 0037](../adr/0037-sonner-shared-singleton.md))

Version alignment across the fleet is a property of the release, not of any one
bundle: a pinned app composes one co-versioned byte set (see
[09 · Publishing](09-publishing.md)).

## Typed clients

UI code calls the API through framework factories that are **phantom-typed** — the
contract is a type parameter, never a runtime value, because every client-facing
contract is generated:

```ts
import { createPluginApiClient } from "everything-dev/ui/api";

export const createDocsClient = (config) =>
  createPluginApiClient<DocsContract>("docs", config);
```

Routes consume the shared client from the router context (`useApiClient()`), so SSR
and hydration use one seam. ([ADR 0006](../adr/0006-client-factories-phantom-typed.md))

## Content

Any workspace can publish documents the way it publishes code. A workspace with a
`velite.config.ts` compiles its collections during its own build; the output rides
the dist as a content artifact, is uploaded and pinned like any other file, and a
consuming plugin can be pointed at it through a `sources` variable. A plugin that
adds a `docs/` folder gets a docs lane: its pages mount under
`plugins/<name>/…`, and the plugin's own pages shadow an app page at the same slug.
([ADR 0053](../adr/0053-docs-content-sources.md),
[ADR 0054](../adr/0054-content-collections-framework-primitive.md))

## Decided, not yet built

[ADR 0010](../adr/0010-composition-contracts-kit-and-precedence.md) also records two
pieces that are not implemented: the design-system kit as a module shared from the
core UI, and `remoteComponent` facades for cross-plugin components. Until they land,
each plugin UI ships its own copies of the components it uses.

## Check it

- `.bos/generated/runtime-map.json` — every route with its owner and mount, every shadowed claim.
- `bos types gen` — regenerates the map and the typed cross-plugin route paths.
- `bos mf check` — every composed remote against the shared singletons it must satisfy.

## Further reading

- ADRs [0008](../adr/0008-manifest-composition.md) and [0024](../adr/0024-composition-stays-manifest-based.md) — the manifest model; [0010](../adr/0010-composition-contracts-kit-and-precedence.md) — precedence and cross-source contracts; [0049](../adr/0049-generation-scoped-ssr-composition.md) — how SSR composition stays coherent.
- The [`everything-dev#ui-integration`](../../packages/everything-dev/skills/ui-integration/SKILL.md) skill — routes, the API client, SSR hydration, the sidebar.
- [The runtime map](../agents/runtime-map.md) — reading the composition inventory.
- Next: [05 · Plugins](05-plugins.md).
