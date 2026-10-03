# ADR 0007: Runtime composition is the SSR model — generic host, boot-time digest-cached compose, source manifests in dev

Date: 2026-09-21
Status: Accepted (amended 2026-09-22 — §8 self-probe is telemetry-only)

Supersedes: nothing (first SSR-model ADR). Related: ADR 0005 (`app.ts` authored descriptor), ADR 0008 (manifest composition + mount registry v2), [plan 034](../../advisor-plans/done/034-manifest-composition-rework.md). (The ui route-grafting-migration plan was never filed as a doc — its content is superseded by ADR 0008; see map issue citynode.app#108.)

## Context

PR #134 (plan 024, auth-ui carve-out) exposed composed-SSR-over-Module-Federation as a recurring failure class. Its 24-commit history is a fix-chain ledger of three structural couplings:

1. **C1 — React trees cross bundle boundaries at request/boot time via the MF node runtime.** Separate MF instances mint separate React copies (`Invalid hook call / useContext of null`); `initializeSharing` returns a promises *array* (`.then` crashes); share-scope init must resolve before every expose load.
2. **C2 — Grafting instantiated singleton TanStack route trees post-hoc.** A spread strips prototype getters (`id`/`path`/`fullPath`); the Route constructor binds `init` as an arrow closure over the original instance, so copies need a re-implementation of `BaseRoute.init` (`graftCopy`) — compose became coupled to router private internals.
3. **C3 — Dev must serve node-env MF entries over HTTP.** Dedicated `ui-ssr`/`plugin-ui-ssr` dev servers, `uiPort+1` allocation, `ssrUrl` patching, publicPath origin-root anchoring (`self is not defined` when web+node share one origin), EADDRINUSE port races, 90-second readiness probes in the regression suite.

Two architectural temptations were evaluated and rejected:

- **Build-time baked host bundles** (compose plugins into the app's server bundle at build). Rejected because it contradicts the platform's boot model: *applications always start from a published `bos.config.json` with remote URLs; the host is always generic; the Dockerfile is always the same.* Baking would require a second server-artifact channel (npm-style server packages alongside MF bundles), breaks plugin deployment independence, kills URL-swap containment and OTA (wayfinder ticket 10), and is moot — current CD is already redeploy-based (`deploy.yml` runs `bos publish --deploy` + Railway redeploy).
- **Fresh-instance grafting as an interim** (deep-copy replacement deleted, per-variant fresh loads keep shallow grafting). Rejected because the committed end state is manifest composition (ADR 0008); shipping one interim composition model to delete it in the next plan is exactly the dual-path maintenance this platform avoids.

## Decision

1. **Runtime composition is the SSR model.** The app *is* the published JSON — a generic host boots from `bos.config.json` remote URLs and composes plugin UI at boot time, digest-cached, SRI-verified. Per-request work is only `createRouter({ routeTree, history: memoryHistory })` + `renderRouterToStream` with session-forwarded context (the route-grafting-migration C2 decision, superseded by [ADR 0008](./0008-manifest-composition.md) — per-request tree composition stays dead). The render pipeline is TanStack-native: `createRequestHandler`, `renderRouterToStream`, native `head:` route options, automatic loader dehydration — no custom plumbing around router-core SSR.
2. **Health-gated composition.** Composition failure at boot fails the host's health check and the deploy — it never silently degrades to the CSR shell forever. The CSR shell remains the per-request tenant-gate failure path only.
3. **Own host = own host instance.** Apps and sovereign tenants run the same generic image parameterized by their own published config (`BOS_ACCOUNT`/`BOS_GATEWAY`, `extends` inheritance) — this is the existing self-deployment model. The parent platform keeps the single generic host for Tier-1 shared tenants; no per-app host builds exist.
4. **Dev and regression consume source manifests.** `bos dev --ssr` composes from source on disk — one module graph, one React by construction, no node-MF, no dev SSR servers, no port patching, no readiness probes. Dev without `--ssr` simply composes nothing (SSR off by default; loud when requested). The dev path consumes the *same manifests* as production (disk-resolved vs MF-resolved) — identical construction code. Regression dev mode rides this and becomes deterministic.
5. **Share-scope hierarchy is explicit and invariant-tested:**
   - **L1 — process-global:** exactly ONE MF composition instance per process (one share scope; React/react-dom/@tanstack singletons negotiate once). Owned by an Effect `SsrFederation` service Layer (landed with plan 034 — the prototype proves the mechanism with the bundled host's build-level provides); share-scope init runs before each expose load and once per in-place re-register — not before every load.
   - **L2 — remote registrations:** re-registered in place on integrity bump (`registerRemotes`), never by minting a second instance.
   - **L3 — module instances:** the ONLY level allowed to duplicate (per-composition-variant freshness), and only of plugin-owned non-shared modules.
6. **Three-source per-request SSR is subsumed by the digest cache.** Base runtime + tenant override + member override (wayfinder ticket 06's sharpening) each resolve to a distinct config → distinct digest → distinct cached composed tree. Per-request work is resolve + hash lookup. What ticket 06 defers is the *member-subdomain resolver feature*, not architecture; no re-architecture is needed when it arrives.
7. **Composition lifecycle is Effect-modeled** per repo conventions (implemented with plan 034 — the prototype proves the mechanism in plain harness code): `SsrFederation` as a `Context.Service` Layer (scoped, boot-fail = unhealthy host), compose variants as digest-keyed memoized Effects with LRU bounds, typed tagged errors at the untrusted remote boundary.
8. **Health = in-process gates + a live self-probe.** In-process composition checks prove the tree; only a post-listen self-request proves the SERVER. The boot health gate is fail-loud on both (the prototype caught this exactly: in-process gates passed while a `Bun.serve`-under-node crash meant the server never listened). Amended 2026-09-22 during plan 034: the in-process boot gate stays fail-loud (`process.exit(1)` on composition failure, prod rolls back); the post-listen self-probe is **telemetry-only** — it logs loudly but never exits, because a degraded root render (e.g. per-request tenant composition failing) is a 500 by contract, not a restart loop, and liveness is the platform healthcheck's job.
9. **The browser client follows the same share-scope model.** One rspack MF web build; the build's runtime owns the page's single share scope with the *identical* shared recipe as the server build (exact version, strictVersion, singleton, non-eager, runtime-registered remotes) — containers and the host client share one React by negotiation. The import-map-as-share-scope alternative (fixed-URL hand-built ESM vendor modules) is REJECTED on evidence (plan 033): every bundler fails a different facet of CJS→ESM with cross-artifact externals, and router deps do runtime `require("react")` — the share scope is the module-identity primitive, proven server-side and in the browser.

## Consequences

- The `ui-ssr`/`plugin-ui-ssr:<id>` dev services, `uiSsr` port allocation, `ssrUrl` dev patching, `dev:ssr` scripts, and the regression SSR readiness probe (`REGRESSION_SSR_PROBE_TIMEOUT_MS`) are deleted in plan 034.
- `graftCopy` never ships as a maintained path: the branch rework (plan 034) deletes the graft machinery outright rather than hardening it (see ADR 0008).
- Build-time bake is recorded as a *future cold-start optimization only* — not a model change — if boot remote-loading cost ever matters.
- Hot-reload of source-composed trees uses cache-bust re-import of generated modules (dev only); hot-reload of MF-loaded modules uses the existing `bypassModuleCache` mechanism (L3).
- Version alignment for the whole stack (router-generator scan semantics, router-core option surface, runtime) is carried by the existing catalog pins — one bump, lockstep.
