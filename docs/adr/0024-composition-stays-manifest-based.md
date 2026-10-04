# ADR 0024: Composition stays manifest-based; route chunks load lazily

Date: 2026-10-04
Status: Accepted

Depends on: ADR 0008 (manifest composition — the host owns the route graph; plugins are standard route files; mounts are gates).

## Context

A design-it-twice pass (2026-10) over the composition interface considered three shapes: (A) keep ADR 0008's runtime manifest composition and align it with TanStack-native vocabulary; (B) build-time tree merging — the official TanStack monorepo pattern, where one router package generates a single route tree from all sources' route files through a virtual route config; (C) shared root-route instances — each remote mints live Route objects against a shared root contract and the host assembles with `addChildren`. The pass also surfaced the sharpest edge of the current engine: tree construction awaits every route's option bundle up front, so every plugin route chunk (components, loaders, error/pending components) is fetched at compose time on both server and client — per-route code splitting is defeated, and a plugin with many routes taxes the first paint of every app that composes it.

## Decision

**A — the manifest architecture stands.** B is rejected because it requires every contributing source on disk at one build: it kills independent plugin deploys and per-tenant runtime composition — the platform's differentiating capabilities. C is rejected because Route objects crossing the federation boundary reintroduce the version-skew coupling ADR 0008 exists to delete; only plain option data crosses remotes, and the host mints everything.

Facelift within A:

1. **Per-route lazy loading — verified, with a corrected mechanism.** Investigation (2026-10) found the heavy per-route code already lazy: the build's code-splitter (TanStack `autoCodeSplitting`) splits `loader`, `component`, `pendingComponent`, `errorComponent`, and `notFoundComponent` into per-match chunks, and the composed flow's route-config loaders import the transformed modules — so component code loads on navigation in both environments (pinned by the plugin-chunk-laziness browser regression). What still awaits at compose is each route's small eager policy module (validateSearch, beforeLoad, head, staticData nav). Deferring those requires relocating the nav declaration out of option bundles into manifest data — a composition-protocol change deferred with the vocabulary work. ADR 0008's flagged coupling ("per-route lazy loads over MF under SSR streaming must be proven") is closed for the composed client path by the regression pin; the server-renders-a-plugin-route-with-lazy-chunks case has no fixture route today.
2. **Vocabulary alignment.** The manifest's route records adopt the naming and shape of the `@tanstack/virtual-file-routes` descriptors (route/layout/index nodes), so composition data reads as TanStack-native rather than as a parallel format.
3. **One identity name per UI.** The composition key, the MF container name, and the authored-config name unify; mismatches stop failing late with container-name diagnostics.
4. **Degraded-mode corner fix.** The CSR path with zero plugin sources passes the core's fallback tree instead of constructing a router with no tree (which throws).

## Consequences

- First paint of composed apps no longer pays for every plugin route chunk; the cost moves to per-navigation.
- Digest semantics are unchanged (structure-only); laziness is invisible to the digest.
- Per-remote failure isolation (one broken remote currently drops all remotes to core-only) is explicitly deferred.
- The type ceiling is accepted: core routes typed via `Register` over routeTree.gen, plugin routes string-typed — typed cross-plugin `<Link>` remains ADR 0008's recorded future consequence.
