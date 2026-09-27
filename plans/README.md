# Implementation Plans

Design documents for the everything.dev v2 platform. These are architecture
and implementation plans, not issue tickets — sprint tickets live in
`.scratch/<feature>/issues/` (local, published to GitHub once ready).

## Directory structure

```
plans/
├── beta-v2/          # v2 platform architecture (5 docs)
├── extensions/       # plans that extend the beta-v2 architecture
├── infra/            # infrastructure & migration plans
├── offline/          # offline support (SW caching + data sync queue)
├── v1-current/       # plans about the current v1 system
├── prototypes/         # runnable prototype source code
├── done/             # completed/superseded plans (mirrors advisor-plans/done/)
└── wayfinder/        # decision maps + open question tickets
```

## wayfinder — active maps

Two wayfinder maps exist:

1. **[beta-v2 map](./wayfinder/beta-v2-map.md)** — the original decision map
   (registry & FastKV architecture, namespace model, caching, gateway and
   platform services). Partially superseded — see its status banner
   (ADR 0011 kills the CDN decisions; ADR 0017 redirects decision 12).
2. **"Everything is a node"** (GitHub [citynode.app#233](https://github.com/NEARBuilders/citynode.app/issues/233))
   — the active map: composable multi-depth tenancy (nodes, zones, Caddy
   edge, zone-wide SSO). Its tickets (#234–#252) live on GitHub, not here;
   local artifacts: root `CONTEXT.md` (City Node glossary),
   `docs/adr/0013-passkeys-bound-to-gateway-origin.md`. Note:
   `sandbox-orchestrator.md` lives on the `spike/sandbox-orchestrator`
   branch and `docs/research/caddy-edge-mechanics.md` on
   `research/caddy-edge-mechanics` — neither is on `main`.

### beta-v2 ticket status

| Ticket | Question | Status |
|---|---|---|
| [01-route-grafting.md](./wayfinder/tickets/01-route-grafting.md) | Web plugin grafting strategy | **RESOLVED** (superseded by ADR 0008) — proven by [beta-v2 prototype](./prototypes/beta-v2/) |
| [02-typed-api-client.md](./wayfinder/tickets/02-typed-api-client.md) | Typed `apiClient` for MF remotes | **RESOLVED** — proven by [override prototype](./prototypes/beta-v2-override/) |
| [03-plugin-type-deps.md](./wayfinder/tickets/03-plugin-type-deps.md) | Plugin-to-plugin type dependencies | Open |
| [04-app-ts-evaluation.md](./wayfinder/tickets/04-app-ts-evaluation.md) | `app.ts` evaluation to deployable config | Open — narrowed (TOML premise dead; `bos.app.ts` operative per #226) |
| [05-backwards-compat.md](./wayfinder/tickets/05-backwards-compat.md) | Host supports both `app.ts` and `bos.config.json` | Open |
| [06-ssr-per-request.md](./wayfinder/tickets/06-ssr-per-request.md) | Per-request SSR route tree composition | **PARTIALLY RESOLVED** — SSR-by-exclusion proven; now also gates member subdomains |
| [07-effect-idiomatic.md](./wayfinder/tickets/07-effect-idiomatic.md) | Effect.ts idiomatic `createPlugin` | **RESOLVED (direction)** — `@orpc/experimental-effect` shipped with oRPC v2 beta; sequenced first on the `v2` branch |
| [08-extends-depth.md](./wayfinder/tickets/08-extends-depth.md) | Transitive `extends` chains | **RESOLVED** — multi-level, verified per hop, depth-capped at 5, publish-time flattening *(depth-cap claim flagged for re-verification 2026-09-26)* |
| [09-stitching-order.md](./wayfinder/tickets/09-stitching-order.md) | Grafting vs UI-extends-UI sequencing | **RESOLVED** (superseded by ADR 0008) |
| [10-hot-swap-lifecycle.md](./wayfinder/tickets/10-hot-swap-lifecycle.md) | OTA hot-swap lifecycle (in-flight requests, teardown, ESM disposal) | Open — prototype required |
| [11-sandbox-db.md](./wayfinder/tickets/11-sandbox-db.md) | Sandbox database engine | **RESOLVED (direction)** — tiered PGlite (workshop) / managed Postgres (production); Neon-via-alchemy leg aspirational, re-derived by node-map #248 |
| [12-build-tooling-absorption.md](./wayfinder/tickets/12-build-tooling-absorption.md) | Root `app.ts` / build-tooling absorption | Open — phase 1 executed (ADRs 0002–0004); phase 2 largely landed (#226; railway.toml slice remains, #118) |

## beta-v2 — the v2 platform architecture

The `app.ts` composition model: one TypeScript file declares the entire
application — auth, API, web plugins, native plugins. The host composes
them at runtime via Module Federation. Tenants override by URL. Everything
is verifiable on-chain via FastKV.

| Document | Covers |
|---|---|
| [overview.md](./beta-v2/overview.md) | Entry point — vision, `app.ts` surface, plugin model, 9-phase rollout |
| [composable.md](./beta-v2/composable.md) | Code-based composition — `App()`, `Plugin()`, `WebPlugin()`, `NativePlugin()` constructors, type system, Effect integration |
| [ui.md](./beta-v2/ui.md) | Web plugin architecture — TanStack Router, mount points, `composeApp()`, grafting, SSR |
| [tenants.md](./beta-v2/tenants.md) | Tenant model — three tiers, sandboxing, data isolation, verifiable deployment graph |
| [native.md](./beta-v2/native.md) | Native (React Native) target — Re.Pack, React Navigation, native plugin structure, token auth, migration guide |

## extensions — plans extending beta-v2

| Document | Covers | Status |
|---|---|---|
| ui route-grafting migration (never filed as a doc) | In-repo migration to grafting ui plugins — SSR corrections (session-forwarded, not exclusion), digest-cached composition, shell/nav mounts, `plugins.<id>.ui` schema extension, phases 1–3 | **SUPERSEDED by ADR 0007/0008** — PR #134 exposed grafting as a structural failure class; manifest composition replaced it. Phases 1–3 of map issue [citynode.app#108](https://github.com/NEARBuilders/citynode.app/issues/108) must be re-scoped against the manifest model before any further work |
| [client-runtime-plugins.md](./extensions/client-runtime-plugins.md) | Browser-executed plugins — `runtime: "client"` field, wasm-git + OPFS storage, BunInBrowser proxy | Independent (backlog, unimplemented) |

*(ui-extends-ui-federation.md moved to [done/](./done/) — superseded by ADR 0008.)*

## infra — infrastructure & migration

| Document | Covers | Status |
|---|---|---|
| [toml-infra-alchemy.md](./infra/toml-infra-alchemy.md) | TOML config, per-plugin Postgres schema isolation, `[infra]` section, Alchemy database provisioning | **STALE** — see the status correction banner in the file: only Phase 2 (schema isolation) is on `main`; Phases 1/3/4 exist only on unmerged `upstream/feat/alchemy` |

*(orpc-v2-effect-migration.md and effect-native-plugins.md moved to [done/](./done/) — shipped to production.)*

## offline — offline support

| Document | Covers | Status |
|---|---|---|
| [shell-sw-caching.md](./offline/shell-sw-caching.md) | Layer 1: service worker for MF asset caching — offline shell rendering | **UNSCHEDULED** — zero implementation; blocker (host MF/shell settling, ADR 0007/0008) is gone |
| [data-sync-queue.md](./offline/data-sync-queue.md) | Layer 2: offline request queue & replay via IndexedDB + Background Sync | **UNSCHEDULED** — builds on [shell-sw-caching.md](./offline/shell-sw-caching.md) |

## v1-current — plans about the current system

| Document | Covers | Status |
|---|---|---|
| [every-plugin-db-auth-absorption.md](./v1-current/every-plugin-db-auth-absorption.md) | Per-plugin database boilerplate absorption — `everything-dev/db` runtime exports (`createDatabaseDriver`/`databaseLayer`/`runMigrations`), namespace-per-engine isolation, tiered migration timing (ticket #89) | **MOSTLY DONE** — core landed in `packages/everything-dev/src/db/`; remainder: `databaseLayer` factory, sync-ownership exit, `plugins/*/db/layer.ts` shrink. See the 2026-09-26 note in the file |

*(tenant-feature-completeness.md moved to [done/](./done/) — implemented and verified.)*

## prototypes — validated architecture

| Prototype | Validates | Related docs |
|---|---|---|
| [beta-v2/](./prototypes/beta-v2/) | Web plugin grafting — `composeApp()` grafts MF remote route trees into host mount points | [ui.md](./beta-v2/ui.md) — **historical**: grafting superseded by ADR 0008 |
| [beta-v2-override/](./prototypes/beta-v2-override/) | Tenant UI override composition — host composes base + tenant override remotes | [tenants.md](./beta-v2/tenants.md) — config-swap composition retained by ADR 0008 |
| [manifest-compose/](./prototypes/manifest-compose/) | Manifest composition — route files → generated manifests → host-constructed route tree with host-attached gates; SSR streaming, per-route lazy over MF, tenant swap (supersedes grafting; ADR 0007/0008; build plan 033, rework plan 034) | [ADR 0007](../docs/adr/0007-runtime-composition-ssr.md), [ADR 0008](../docs/adr/0008-manifest-composition.md) — **the live reference prototype** |

*(db-auth-absorption/ moved to [done/db-auth-absorption-prototype/](./done/) — absorbed into shipped code.)*

## Completed plans (removed)

| Plan | Title | Outcome |
|---|---|---|
| 003 | Require `API_DATABASE_URL` in production | Implemented in v2.7.4, then reverted in v2.7.5 (pglite guard removed) |
| 006 | Add warnings to empty catch blocks | Implemented in v2.7.4 |
| 007 | Add CSRF protection to state-changing endpoints | Implemented in v2.7.4 — lives in `host/src/middleware/security.ts` |
| react-native-migration | React Native migration plan | Folded into [native.md](./beta-v2/native.md) — architecture + implementation guide merged |
