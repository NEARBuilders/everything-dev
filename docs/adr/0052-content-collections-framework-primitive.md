# 0052 — Content collections as a framework primitive

Date: 2026-11-28
Status: accepted
Builds on: 0051 (docs content sources), PR #450

## Context

The docs plugin (ADR 0051) hand-rolled three things that exist for code
already:

1. a build-time compile step (an rspack plugin class in `build.config.ts`),
2. knowledge of the repo's directory conventions (`plugins/*/docs/**` globs),
3. a private source registry in its service.

The framework's composition primitive — directory convention, manifest
description, runtime-map inventory — works for code but had no shape for
non-code resources. Graduating the general form makes the framework simpler
(more declarative) and more powerful (any workspace can publish content,
not just this one plugin).

## Decision

### 1. Content compilation is a build-factory convention

A workspace that contains a `velite.config.ts` compiles its collections
inside its rspack build — `createPluginBaseConfig` auto-wires the
framework-owned `ContentCompilerPlugin`; no hand-written build integration.
The plugin owns the two lessons the docs plugin paid for:

- **watch scoping**: velite's own watch scans its config root recursively
  (unfilterable) — a repository-root content source points it at
  node_modules and crashes past the process file-watcher limit (EMFILE).
  The framework watches the collection patterns instead and reruns the
  non-watching build per change; the rewritten output entry recompiles the
  workspace through rspack's own watcher.
- **workspace-anchored resolution**: velite and chokidar resolve from the
  declaring workspace's dependencies, not every-plugin's — the framework
  never hard-depends on a content compiler.

`content: false` in the base-config options opts out for workspaces that
wire `extraPlugins` by hand. Velite is the blessed default compiler; it is
not a framework dependency.

### 2. The manifest describes non-code resources

`plugin.manifest.json` self-describes what a workspace publishes beyond its
contract, by convention:

- `content: { compiler: "velite" }` when a `velite.config.ts` exists
- `docs: { dir: "docs" }` when the workspace ships a `docs/` directory

A composing runtime learns what a plugin publishes from one file — locally
or from a deployed bundle's manifest.

### 3. Content artifacts ride the dist

The compiler emits each compiled collection as a dist asset
(`content/<collection>.json`), read from disk at emit time. The deploy
train's generic file upload already diffs, SRI-pins, and version-directories
every dist file — so content becomes a first-class artifact (uploadable,
pinnable, cacheable) with **no content-specific deploy leg**. Content
publishes with its plugin; a changed corpus re-uploads on the next deploy.

### 4. Consuming side: content sources as plugin variables

A content-serving plugin may declare a `sources` variable —
`[{ name, url }]` of published content artifacts. At boot it fetches each
(bounded, fail-loud) and serves the fetched corpus instead of its baked
bundle; empty/absent keeps the baked corpus. This is the composing-app
story: a runtime can point a reader plugin at its own published content
without forking the plugin.

### 5. The runtime map inventories content sources

`.bos/generated/runtime-map.json` gains a `content` section (and the TS
emission `RUNTIME_CONTENT_SOURCES`): the composing app's docs tree as the
`app` source mounted `/`, each local plugin workspace's `docs/` dir mounted
`plugins/<id>`, and remote plugins declaring `docs.dir` in their manifest.
Ownership questions — "where does this doc come from, who publishes it" —
are answered from the same inventory as routes and backends.

## Consequences

- The docs plugin deleted its hand-rolled integration (`build.config.ts`)
  and now declares only its domain schema (`velite.config.ts` collections).
- Any plugin can publish content or a docs lane by adding directories —
  "add a docs folder, get a docs lane" is now a framework property, not a
  docs-plugin feature.
- **Sequenced next**: the deploy-train content leg for runtimes composing a
  *remote* reader — compile the runtime's declared content sources during
  its own deploy (from its checkout), upload under a content slot, and wire
  the resulting artifact URLs into the reader plugin's `sources` variable.
  The consuming side (this ADR §4) is already live; the leg is the last
  piece that makes "your docs attach" true for children without a
  checkout-run build of their own.

## Alternatives considered

- **Framework hard-depends on velite** — would force the dependency on every
  plugin install; workspace-anchored dynamic resolution keeps the compiler
  optional and swappable.
- **A generic shadowing/mount engine in the framework** — the composition
  layer's existing route/mount semantics stay the only engine; content
  reuses them by reference (ADR 0051), it does not re-implement them.
- **Glob-driven source discovery in the compiler** — the docs plugin's
  original approach; it baked one repo's layout into a plugin. Directory
  convention per workspace plus manifest declaration scales without the
  coupling.
