# 0048 — Generation-scoped SSR composition (hot swap as the invalidation primitive)

Date: 2026-11-27

## Context

A dev rebuild does not reach the served SSR tree. The churn money test on
current main (2026-11-27, `.scratch/ssr-first-paint-2/baseline.md`) proves it
end to end: after a real 5.4s rsbuild rebuild, the new generation's bytes sat
on disk (`ui/dist/ssr/static/js/async/*`), the compose variant cache expired
every 2 seconds, and the served tree kept rendering the pre-churn generation
for the full 75-second poll — every response a healthy 200 SSR tree. The dev
loop looks fine and silently lies.

Two stale layers cause it, and both are failures of the same design choice —
TTL-as-invalidation:

1. **Loader-level TTL caches** (`federation.server.ts`:
   `ROUTER_MODULE_CACHE_TTL_MS`, `UI_EXPOSE_CACHE_TTL_MS`,
   `SSR_INTEGRITY_CACHE_TTL_MS`, all 5 minutes). A cache that expires on a
   clock rather than on a change is wrong precisely when the underlying bytes
   can change underneath it — which is the dev loop's normal.
2. **The Module Federation runtime reuses an initialized container** for a
   remote name no matter what the registration says. Main's only defense —
   `bypassCompositionModuleCache` when an entry *URL* changes — cannot fire in
   dev, because the dev entry URL (loopback, no version query) never changes.
   The original epic filed this as #478; the empirical verdict is that it is
   still live.

The surrounding state makes both hard to fix in place: `federation.server.ts`
holds one module-scope MF instance plus module-scope Maps with no owner, no
finalizers, and no generation notion — nothing marks "these bytes belong
together". Meanwhile the load-bearing production behavior (boot-warm compose,
SRI integrity, in-flight dedupe, negative caching, snapshot pre-warm → atomic
swap) must not regress.

## Decision

**The generation is the unit of coherence.** Every SSR compose opens a
generation-pinned session: all of its module loads execute inside one
composition generation, and caches key by that generation. A generation is
retired as a whole; a newer one replaces it atomically for new composes
(in-flight composes keep the session they pinned — shadow-flip, no drain).
Concretely, four scoped Effect services replace `federation.server.ts`:

- **`CompositionRuntime`** — owns the ONE live MF composition instance per
  generation. Invariants: (1) one instance per generation ⇒ one share scope
  (singleton negotiation for react/@tanstack/* happens once; mixed React
  copies crash with "Invalid hook call"); (2) a remote never seen before
  registers in place; (3) an ENTRY CHANGE for a registered remote — entry URL
  or container version — retires the whole generation (the runtime reuses
  initialized containers, so the only honest swap is a fresh instance carrying
  the full desired entry set); (4) share-scope init is Semaphore-serialized;
  (5) every instance, live or retired, dies with the host scope's finalizer —
  no global disposal.
- **`FederationContainers`** — `ScopedCache` of dev loopback dist servers keyed
  by `localRoot`; each server's stop is its entry finalizer.
- **`FederationLoader`** — expose / router-module / integrity verification
  behind Effect Cache whose keys carry the generation id. A retired
  generation's cached modules can never serve into a newer tree. In-flight
  dedupe and exit-based negative caching are preserved (negative TTL is a
  failure-window policy, not an invalidation mechanism).
- **`UiComposer`** — a service tag over the compose surface. Its variant/
  manifest cache state stays snapshot-owned (pre-warm → atomic swap), because
  the swap mechanism belongs to the snapshot, not the composer.

**The dev fingerprint is the generation trigger.** A dev source's freshness
coordinate is the manifest mtime AND the built container's mtime — the src
manifest alone misses rebuild-only changes, which is exactly the churn shape.
Prod's coordinate stays the deployed SSR integrity.

**Plane split.** UI swaps in-process by generation. API/auth/plugin backends
never hot-swap in-process: they move by generation through the adopt path
(`BOS_HOLD_ON_BACKEND_CHANGE`, the persisted approved snapshot), so a
generation's UI+API pair serves coherently or the generation waits. Integrity
verification consumes main's verify spine (`everything-dev/verify`) — one SRI
implementation, no private loader path.

## Consequences

- The churn test goes green: a rebuild serves the new generation on the next
  compose (seconds), and healthy-looking staleness becomes structurally
  impossible — a generation either serves whole or retires whole.
- TTLs demote from correctness mechanisms to performance hints. The 5-minute
  loader TTLs keep their prod role; dev correctness rides generation keying.
- `federation.server.ts` dies; its consumers (program boot wiring, ssr route,
  ui compose, snapshot coordinator pre-warm) rewire through the lifecycle
  layer, and module-scope mutable state leaves the host.
- Steady-state perf must hold the recorded baseline (dev:ssr TTFB p50 7.0ms,
  compose p50 5.1ms — `.scratch/ssr-first-paint-2/baseline.md`); the churn
  harness guards it.
