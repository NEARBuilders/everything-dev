# ADR 0008: Manifest composition — the host owns the route graph; plugins are standard route files; mounts are gates

Date: 2026-09-21
Status: Accepted

Depends on: ADR 0007 (runtime composition SSR model). Builds on: [beta-v2 prototype](../../plans/prototypes/beta-v2/) (grafting — superseded by this ADR), [beta-v2-override prototype](../../plans/prototypes/beta-v2-override/) (config-swap composition — retained), plan 023 (typed mount contract — demoted to build-time validation), [plan 033](../../advisor-plans/done/033-manifest-compose-prototype.md) (prototype gate), [plan 034](../../advisor-plans/done/034-manifest-composition-rework.md) (the rework).

## Context

Grafting — PR #134's mechanism — transplants *instantiated* TanStack route trees from plugin bundles into the host tree. Every difficulty in the grafting saga traces to that single property: the compose unit is live objects. Reparenting foreign-constructed routes requires `getParentRoute` surgery, id namespacing, and (because one process composes the same instance into multiple variants) deep copies re-implementing `BaseRoute.init` — a coupling to router private internals that must be re-pinned on every TanStack upgrade. Type safety is runtime-structural only: grafted paths never enter the app's `Register` type (hence #134's `pluginPath`/`pluginHref` seam), and nothing about a plugin's route surface is knowable without executing its code.

Separately, plan 024's declared-mount contract (`defineUiPlugin({ name, mounts, tree })` in a hand-written `tree.ts`) was rejected as authoring surface: mounts and the plugin name should be **derived from file names** — the file system is the config — and plugin `__root` should be able to carry metadata (`head`, `staticData`) that composition lifts.

Investigation (2026-09) found the framework itself converging on the same substrate: `@tanstack/router-generator` is a published scan engine (route files → route nodes, no code execution); `createLazyRoute` formalizes a critical/non-critical option split (path/loaders/beforeLoad/head eager; component/errorComponent/pendingComponent lazy); TanStack Start v1 ships `StartManifest`/`ServerManifest` builders with SSR dehydration; rsbuild support is landing in Start. A manifest model rides the framework's direction instead of fighting its object internals.

## Decision

1. **The host owns the route graph; plugins own route content.** The host constructs *its own* Route objects from plugin manifests via public `createRoute`/`createLazyRoute` APIs and parents them into its tree with `addChildren`. No foreign route object is ever mutated. `addChildren`-on-host-owned-routes is documented API — the entire `graftCopy`/init-rebinding problem class is deleted, not fixed.
2. **A plugin's entire authoring surface is standard TanStack route files. No `tree.ts`, no `defineUiPlugin`, no manifest fields, no config — nothing hand-maintained, at all.** Three artifacts are generated from those files:
   | Artifact | Emitted by | Contains | Consumed by |
   |---|---|---|---|
   | `routeTree.gen.ts` | upstream `tsr generate`, untouched | the plugin's own tree | plugin-local standalone dev/typecheck (stock TanStack DX, free) |
   | `manifest.gen.json` | a thin generator step riding `@tanstack/router-generator`'s scan API | pure data: route ids, paths, nesting, mount (derived from root `_` files), file refs, `__root` head/staticData | host tree construction — serializable, auditable, marketplace-browsable |
   | `route-config.gen.ts` | same step | generated import map `{ [routeId]: { loader, beforeLoad, head, staticData, component } }` — real function refs | host loads once at boot; per-route lazy content via the same map |
   The generator step lives in `every-plugin`'s build (alongside `EmitPluginManifest`), watches in dev, and validates at build time (derived mounts ⊆ registry, unique paths, thin `__root`, file-based-only) — plan 023's contract demoted from runtime declaration to build-time validation of generated input.
3. **Mount registry v2 — gates only, shape-free.** Mounts are *gates + host-owned pathless layout positions*, never product containers:

   | Mount | Gate (host-enforced) | Shape |
   |---|---|---|
   | `_public` | none | free — login, landing `/`, docs, any plugin |
   | `_authenticated` | session | free — dashboards, `/orgs` browsing, any routes |
   | `_admin` | admin role | free |
   | `_org` | org member | parameterized (`/organization/$orgSlug`) — the org workspace |
   | `_team` | team member | parameterized — the team workspace |

   Consequences: no mount name nests inside another (the gate-aware `resolveCoreMount` collision class dies at the root); the shell concept leaves the registry (host chrome only); a plugin cannot ship a route that escapes its mount's gate because it never constructs route objects; multi-plugin-per-mount (`_public` = login + landing + docs from three plugins) is first-class. Login lives on `_public` with a route-level reject-authed `beforeLoad` in the route file — not a mount. Migration aliases: `_dashboard` → `authenticated`, `_organization` → `org`, `_auth` → `authenticated`. Registry version bumps once; compose digests invalidate.
4. **Dev = prod path shape.** The host consumes the same manifests from source on disk in dev and over MF in production — identical construction code, differing only in resolution. Dev SSR needs no MF at all (ADR 0007 §4).
5. **Nothing is kept as a fallback.** Plan 034 deletes the graft machinery (server *and* client compose), `defineUiPlugin`, `tree.ts`, `./tree` exposes, `resolveCoreMount`, and the `pluginPath` seam in the same change that lands manifests. Main stays green (core-only SSR) until the rework lands — no interim dual-path state exists. The prototype (plan 033) gates the rework.
6. **Ecosystem affordances this unlocks** (the reason data-over-objects is the point, not a side effect): app route surfaces are auditable from published config + manifests without executing plugin code; the `plugins/apps` registry can render plugin route inventories pre-install; trust tiers can compose manifest-only (browse) vs manifest+content (execute); hot-swap (ticket 10) becomes a data swap with clean module-cache disposal; manifests are framework-neutral data for the native target.
7. **Client build contract (proven in plan 033's hydration e2e).** The host's browser client is ONE rspack MF web build — the browser twin of the server recipe: identical exact-strict-singleton shared map, no build remotes (runtime `registerRemotes` from the compose payload), async-boundary entry, and the build's MF runtime owns the page's share scope. The client entry is a custom Start-style entry — payload → `loadRemote` route configs → `constructTree` → `hydrateRoot(RouterClient)` — the one divergence from TanStack Start's managed entries, which cannot express runtime composition (Start owns build-time route trees). Two payload identities stay distinct: *composition* (plugin key + manifest — digested, deliberately deployment-free so disk and prod paths digest identically) and *deployment* (mfName + entry — the `loadRemote` target); payload remotes carry `{ key, name, entry }`. Plugin WEB builds must set `publicPath: "auto"` so container chunks resolve from the remote's own origin, never the composing page's.

## Known couplings (accepted, versioned)

- The manifest schema tracks TanStack's *public* route-option surface — a public-API coupling, far cheaper than grafting's private-internals coupling, and carried by the catalog's lockstep version pins.
- Per-route lazy loads over MF under SSR streaming must be proven — gated by plan 033's prototype before the rework starts.
- `routeTree.gen.ts` remains for plugin-local standalone DX only; production never consumes it.
- `manifest.gen.json`'s `name` equals the descriptor's plugin key — the compose digest and the client's manifest lookup rely on this generator invariant.
- Plugin web builds depend on `publicPath: "auto"` reaching rspack output via `tools.rspack` function-form mutation — `environments.*.output.publicPath` does not survive rsbuild 2.2.8's rsbuild→rspack conversion (verified empirically in plan 033); re-verify on rsbuild bumps.

## Consequences

- `MOUNT_REGISTRY_VERSION` bumps; all compose digests invalidate once.
- Plan 025 (landing carve-out) executes manifest-first as the second production consumer; plan 026 (shell into host) simplifies — the host constructs all routes, in-process or manifest-fed, one construction story; plan 028 (`app.ts`) absorbs a stable manifest-only plugin shape.
- `bos types gen` gains merged route-type emission from manifests (typed cross-plugin `<Link>`) — replaces the `pluginPath` seam.
