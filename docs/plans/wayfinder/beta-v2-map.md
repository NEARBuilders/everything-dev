> **Status banner (2026-09-26 audit):** this map remains the consulted
> parent for the beta-v2 architecture, but three areas have moved on:
> (1) decisions 9 & 11 (Zephyr CDN → R2/S3 deploy service) are superseded
> by **ADR 0011 image-native artifacts** — no CDN provider, no uploads;
> (2) decision 12 (gasless publish via NEP-366 delegates) is redirected by
> **ADR 0017 session gas keys** (NEP-611 browser-signed writes); (3) the
> tenancy/sandbox tier framing (decisions 14/15) is being re-derived in
> node/zone vocabulary by the **"Everything is a node" wayfinder**
> (citynode.app#233–#252), which consults this map. Also note
> "web plugin grafting" below is superseded by ADR 0008 manifest
> composition.

## Destination

Validate that the beta-v2 architecture (`app.ts` composition, web plugin grafting, plugin-to-plugin type dependencies, backwards compat) is a sound, composable e2e design before committing to the 9-phase build. The deliverable is a ratified architecture — decisions locked, no unknown unknowns — ready to hand off for implementation.

## Notes

- Domain: everything.dev v2 runtime — Module Federation, TanStack Router, oRPC, Effect.ts, FastKV
- Skills: `/grilling`, `/domain-modeling`, `@tanstack/devtools#*`, `everything-dev#*`, `every-plugin#plugin-development`
- Prefer Effect.ts idiomatic patterns: `Layer`, `Context.Tag`, `yield*`, `Effect.gen`. Avoid `tools.buildService` — services resolve via `yield* Tag` in `.effect()` handlers (see Effect-idiomatic Services section and `../infra/orpc-v2-effect-migration.md`)
- Running codebase is in `host/`, `ui/`, `api/`, `plugins/`, `packages/`. Read source, don't guess.
- Research-driven: check TanStack Router source/docs before deciding on grafting strategy. Check oRPC source before deciding on type propagation.

## Decisions so far

1. **Namespace model: hybrid, NEAR account default** — namespace is a `.near` account
   (e.g., `dev.everything.near`). Domain aliases are additive later
   (`pizza.near/checkout` = `pizza.com/checkout` via verified alias), not
   required up front. Rationale: NEAR accounts are already the identity anchor
   (SIWN auth, tenant hierarchy, FastKV partitioning, predecessor_id on every
   write). Domain-first means rebuilding identity from scratch.

2. **Version keys: separate immutable keys + latest pointer** — `modules/{ns}/{name}/manifest`
   is overwritten on each publish (latest). `modules/{ns}/{name}/versions/{version}`
   are immutable snapshots. Rationale: FastKV is append-only indexed storage — each
   write is a new row. Separate version keys are FastKV-native, give free audit
   trail via history endpoints, and prevent mutating published versions.

3. **Everything is a module — "app" = `kind: "app"`** — no separate registry layer
   for apps vs modules. One key prefix (`modules/{ns}/`), one API, one scan
   pattern, optional filtering by `kind`. The registry doesn't need to know about
   composition — that's the orchestrator's job.

4. **ModuleRecord: two-phase build → publish wrapping** — `EmitPluginManifest`
   emits `plugin.manifest.json` at build time (what rspack knows). `bos publish`
   wraps it with runtime metadata (publisher, timestamp, final integrity) to
   produce the `ModuleRecord`. Build and publish are distinct phases.

5. **Integrity enforced at all three points** — write-time: integrity + timestamp
   baked into ModuleRecord on FastKV. Resolve-time: gateway verifies publisher
   attestation (did this account publish this module?). Load-time: host runs SRI
   check before executing remote entry. Extends the current `integrity-monitor.ts`
   pattern. SRI hashes double as cache keys for the offline service worker — a
   version change invalidates cached `remoteEntry.js` automatically, no
   additional invalidation logic needed.

6. **ModuleRecords are separate FastKV entries; config references them** —
   ModuleRecords live at `modules/{ns}/{name}/manifest`. Published app config
   (TOML) references modules by `{ns}/{name}@^{version}`. The gateway resolver
   fetches actual ModuleRecords from FastKV at resolve-time. Configs stay small
   (just references); ModuleRecords are independently discoverable, searchable,
   and resolvable without loading any app config.

7. **Monolithic FastKV partition, key-prefix namespaced** — one FastKV
   contract (`dev.everything.near`) stores all modules. Logical namespacing via
   key prefix (`modules/dev.everything.near/...` vs `modules/pizza.near/...`).
   Rationale: cross-namespace discovery via single prefix scan. Per-namespace
   partitions require querying N contracts — explodes complexity for no real
   benefit. Key-prefix filtering + publisher attestation (decision #5) provide
   the same isolation without the topology cost.

8. **No separate dev registry — the registry is a view, not a service** —
   The "registry" is the result of prefix-scanning `modules/` on FastKV, not a
   standalone deployable. In dev, module resolution has two paths: local
   workspaces resolve via dev server (no FastKV, `cdn_url = localhost`, no
   integrity), published remotes resolve via FastKV ModuleRecord (same as prod).
   No separate "test registry" or registry account — each publisher writes
   their own ModuleRecord directly.

9. **Four-layer caching** — FastKV is the metadata/attestation layer
   (who published what, when, with what integrity). Zephyr CDN is the content
   delivery layer (the actual bytes — `remoteEntry.js`, types, assets). The
   gateway is the resolution layer (module name → ModuleRecord → CDN URL +
   integrity). The host is the execution layer (fetch from CDN, verify SRI,
   load via Module Federation). A service worker adds a **local cache** layer
   that transparently caches MF assets (`remoteEntry.js`, plugin UI entries,
   static files) for offline shell rendering — no composition model changes,
   the SW matches URL patterns structurally. In dev, the CDN swaps to
   localhost dev servers — same flow, different URL source.

## Architecture Sketch

```
┌────────────────── Gateway (Effect.ts services) ──────────────────┐
│  Resolver:    {ns}/{module}@version → ModuleRecord               │
│  Verifier:    integrity check (SRI) + publisher attestation      │
│  Policy:      namespace rules, version constraints, allow/deny   │
│  Routing:     direct requests to the appropriate host/endpoint   │
└──────────────────────────────┬───────────────────────────────────┘
                               │ resolved ModuleRecord
┌─────────────── Runtime / Orchestrator (host) ────────────────────┐
│  Offline:     SW caches MF assets (Shell), IndexedDB queue for   │
│               mutations (Data Sync) — transparent to composition │
│  Loader:      fetch remote entries via Module Federation         │
│  Executor:    run modules in isolation (future sandboxing)       │
│  Composer:    build composed app from manifest DAG (app.ts)      │
│  Lifecycle:   initialize, scope, shutdown per-module             │
└──────────────────────────────────────────────────────────────────┘
```

Gateway services are Effect.ts services composed into the host (not a separate
deployable). For now this keeps the architecture simple while preserving clean
separation of concerns — the gateway is a set of resolvable services, not a
network hop. A standalone gateway deployment remains possible later.

The host fetches the root manifest from a well-known URL, then resolves its
module graph through the gateway.

## Registry & FastKV Architecture

### Module namespace design

Registries today are app-centric: `apps/{account}/{gateway}/bos.config.json`.
Beta-v2 moves to module-centric: `{namespace}/{module_name}`. A module has its
own identity independent of who published it and what domain it serves.

**Decision**: hybrid model — namespace is a `.near` account by default
(e.g., `dev.everything.near/registry`). Domain aliases are additive later
(`pizza.near/checkout` ↔ `pizza.com/checkout`), not required up front. NEAR
accounts are already the identity anchor (SIWN auth, tenant hierarchy, FastKV
partitioning, predecessor_id on every write). Domain-first means rebuilding
identity from scratch before the problem exists.

### .near integration

`.near` accounts serve multiple roles:
- **Identity**: who published the module (publisher field in ModuleRecord)
- **Auth**: SIWN sign-in, sub-account creation
- **FastKV namespace**: the NEAR account that partitions KV storage (today's
  `registryNamespace`)
- **Tenant hierarchy**: NEAR accounts serve as config namespaces (FastKV keys,
  publisher identity), but the host no longer derives accounts from hostnames
  algorithmically. The `domain_bindings` table is the authoritative source for
  hostname → config resolution (see decision #10).

**Decision**: monolithic FastKV partition (`dev.everything.near`) with
key-prefix namespacing (`modules/dev.everything.near/...` vs
`modules/pizza.near/...`). One contract, one prefix scan for unified
cross-namespace discovery. Key-prefix filtering + publisher attestation
provide the same namespace isolation as per-partition contracts without the
multi-contract query complexity.

### CDN separation

Three layers, clean separation:

```
Build  →  Zephyr upload  →  cdn_url + integrity
                                  ↓
            bos publish  →  ModuleRecord {
                              cdn_url, integrity,
                              publisher, timestamp
                            }
                                  ↓
            Write to FastKV  →  modules/{ns}/{name}/manifest
                                  ↓
Gateway  →  Read FastKV  →  resolve {ns}/{name}@version
                                  ↓
            Return ModuleRecord  →  { cdn_url, integrity }
                                  ↓
Host     →  Fetch from CDN  →  verify SRI  →  load via Module Federation
```

- **FastKV**: metadata, discovery, attestation — who published what, when, with
  what integrity hash. Queryable, auditable, immutable history.
- **CDN (Zephyr)**: content delivery — the actual bytes (`remoteEntry.js`,
  types, assets). Cacheable, geo-distributed, nothing to do with identity.
- **Gateway**: resolution — module name → FastKV lookup → ModuleRecord → CDN
  URL + integrity. No content, no storage, just routing.
- **Host**: execution — fetch from CDN, verify SRI integrity, load via Module
  Federation. Untrusting — the CDN URL is only trusted after SRI passes.

In dev, the CDN layer swaps to localhost dev servers. The ModuleRecord for
local workspaces has `cdn_url = "http://localhost:3110/"` and `integrity = null`
(no SRI for local). Same flow, different URL source. Published remotes resolve
the same as prod — ModuleRecord from FastKV → CDN URL + integrity → load.

### FastKV optimal key strategy

FastKV is an indexed key-value store on NEAR. Read patterns drive key design:

| Operation | FastKV endpoint | Key pattern |
|-----------|----------------|-------------|
| Discover all modules in namespace | `POST /v0/latest/{ns}` prefix scan | `modules/{namespace}/` |
| Resolve module by exact name | `GET /v0/latest/{ns}/{key}` | `modules/{namespace}/{module}/manifest` |
| Resolve module at version | `GET /v0/latest/{ns}/{key}` | `modules/{namespace}/{module}/versions/{version}` |
| Audit module history | `GET /v0/history/{ns}/{key}` | `modules/{namespace}/{module}/manifest` |
| Batch resolve dependencies | `POST /v0/multi/{ns}` | Multiple exact keys |

Key design principles:
- **Prefix scans for discovery** — all modules under a namespace share a
  prefix, enabling paginated listing with opaque `page_token`
- **Exact-key for resolution** — once the module name is known, use the
  fastest read path (latest by exact key)
- **Multi-lookup for dependency chains** — resolve N module records in one
  request
- **History endpoints for verification** — verify publisher provenance and
  timestamp ordering without a separate audit log

**Decision**: separate immutable version keys + a latest pointer key.
`modules/{ns}/{name}/manifest` is overwritten on each publish (latest
reference). `modules/{ns}/{name}/versions/{version}` are immutable snapshots.
FastKV is append-only indexed storage — separate keys are FastKV-native, give
free audit trail via history endpoints, and prevent mutating published versions.

### Module vs app discovery

Today the registry discovers "apps" (published `bos.config.json` entries) and
resolves plugins from within those apps' configs. In v2, modules are the atom
of discovery and composition. An "app" is just a module of `kind: "app"` — it
composes other modules via `depends_on`.

**Decision**: everything is a module. One key prefix (`modules/{ns}/`), one
API, one scan pattern, optional filtering by `kind`. The registry doesn't need
to know about composition — that's the orchestrator's job (see app.ts model in
`../beta-v2/composable.md`).

## Manifest Schema (ModuleRecord)

The ModuleRecord schema follows the rspack Module Federation manifest
convention. It is the atom of resolution — not `bos.config.json` (which stays
as the host's runtime wiring).

**Decision**: two-phase build → publish. `EmitPluginManifest` emits
`plugin.manifest.json` at build time (what rspack knows — exports, contract
types). `bos publish` wraps it with runtime metadata (publisher, timestamp,
final integrity) to produce the `ModuleRecord` on FastKV.

**Decision**: integrity enforced at all three points — write-time baked into
the record, resolve-time publisher attestation, load-time SRI before execution.

```typescript
interface ModuleRecord {
  schema_version: number;    // manifest schema version (starts at 1)
  name: string;              // {namespace}/{module_name}
  version: string;           // semver
  kind: "app" | "plugin" | "auth" | "ui";
  cdn_url: string;           // where to fetch remoteEntry.js
  integrity: string;         // SRI hash (sha384-...)
  publisher: string;         // NEAR account that published
  timestamp: number;         // unix seconds (u64), set at publish time
  depends_on: string[];      // module refs: {ns}/{name}@^{version}
  exports: ModuleExport[];   // named exports this remote provides
  contract?: {
    kind: "orpc";
    types_url: string;       // path to bundled contract.d.ts
    integrity: string;
  };
  variables?: Record<string, unknown>;  // required config
  secrets?: string[];                   // required secret keys
  tags?: string[];                      // discovery tags
}

interface ModuleExport {
  name: string;              // export name, e.g. "Router", "createClient"
  kind: "component" | "client" | "router" | "plugin";
  integrity?: string;
}
```

## TOML and Config Authoring

- TOML stays as the human authoring format (self-documenting, comments);
  JSON is the registry format on FastKV. Aligns with the current
  `config-source.ts` split (TOML local, JSON published).
- `app.ts` is the evaluated, typed composition root.

**Decision**: ModuleRecords are separate FastKV entries, not embedded in
config. Published app config (TOML/JSON) references modules by
`{ns}/{name}@^{version}`. The gateway resolver fetches actual ModuleRecords
from FastKV at resolve-time. Configs stay small; ModuleRecords are
independently discoverable without loading any app config.
- Keep `bos.config.json` as the host runtime config — the migration is about
  what gets registered/discovered, not about removing host config.

## Effect-idiomatic Services (oRPC v2)

- Purpose of the v2 map is to avoid `tools.buildService` — the imperative
  layer-extraction workaround. Plugins return raw `Layer`s from `initialize`,
  services resolve via `yield* Tag` in `.effect()` handlers, and the host
  merges plugin `Layer`s into a shared oRPC Effect context.
- Gateway services (resolver, verifier, policy, routing) follow the same
  pattern: plain Effect `Context.Tag` services composed via `Layer`, not
  `tools.buildService`.
- Tracked in `../infra/orpc-v2-effect-migration.md`; open questions remain in
  `tickets/07-effect-idiomatic.md`.

10. **Data-driven domain routing — no algorithmic hostname parsing** — the host
    resolves incoming hostnames via a cached `BindingResolver` service that reads
    from the API's `domain_bindings` table (not by splitting hostnames and
    constructing NEAR accounts). This decouples routing from tenancy: a
    subdomain can resolve to a tenant's config, a standalone app's config, or a
    custom domain — all through the same lookup. The previous `resolveTenantAccountId`
    algorithmic derivation is retired. `TENANT_WHITELIST` and `ALLOW_OVERRIDE`
    env vars are retired; permission flags (`allow_ui_overrides`,
    `allow_backend_overrides`, `allow_ssr`) live on the tenant record in the DB.
    Custom domain verification starts with traditional DNS TXT; NEAR DNS is
    an additive option later. This matches the universal pattern used by Vercel,
    Shopify, and Netlify: wildcard DNS captures all subdomains, a routing table
    maps hostnames to tenants, and no algorithmic derivation exists.

## Domain Routing & Binding Resolution

### Problem

The current host uses algorithmic hostname parsing (`resolveTenantAccountId`)
to derive a NEAR account from every subdomain: `pizza.everything.dev` →
`pizza.everything.near`. This conflates three concerns:

- **Routing** — which config does this address serve?
- **Composition** — does the config extend the base, or stand alone?
- **Identity** — which NEAR account owns this config?

It also forces every subdomain to follow the `{label}.{namespace}.near` convention
and assume the config extends the base. Custom domains and standalone subdomain
apps have no path.

### Model

A **domain binding** is simply:

```
hostname → (configAccount, configGateway)
```

No types. No enums. A binding says "this hostname loads this config." The config
itself defines composition via `extends` — the routing layer doesn't know or care.

| Scenario | Binding | Config's `extends` | Behavior |
|---|---|---|---|
| Tenant | `pizza.everything.dev` → `(pizza.everything.near, everything.dev)` | Extends base | Merge + UI overrides |
| Standalone | `dashboard.pizza.dev` → `(dashboard.pizza.near, pizza.dev)` | None | Independent app |
| Custom domain | `pizza.com` → `(pizza.everything.near, everything.dev)` | Same as tenant | Same app, different address |
| Gateway root | No binding found | Base config | Default behavior |

Tenants, standalones, and custom domains aren't types — they're emergent behaviors
from the shape of the config being loaded.

### Where Bindings Live

| Layer | Data | Store | Why |
|---|---|---|---|
| Routing | `hostname → config location` | API DB (`domain_bindings`) | Dynamic writes, self-service, no gas |
| Verifiability | `config content + integrity` | FastKV | Immutable, signed, auditable |
| Performance | `cached binding map` | Host memory (30s TTL) | Sub-ms lookup per request |

The API plugin's `tenants` table gains per-tenant permission fields
(`allow_ui_overrides`, `allow_backend_overrides`, `allow_ssr`) replacing the
former `TENANT_WHITELIST` and `ALLOW_OVERRIDE` env vars. A new `domain_bindings`
table links tenants to hostnames (primary subdomain + custom domains).

A new public endpoint `GET /tenants/bindings` returns all active bindings
for the gateway. The host's `BindingResolver` service fetches and caches this
map, providing O(1) hostname lookups.

### Host Resolution Flow

```
request hostname
  │
  ├── BindingResolver.resolve(hostname)
  │     └── cache hit → O(1) map lookup
  │     └── cache miss → GET /tenants/bindings → refresh cache
  │     └── no binding → serve base config (gateway domain)
  │
  ├── Load config from bos://{configAccount}/{configGateway}
  │     └── same loadRemoteConfig as today
  │
  ├── Status gate: binding.status → suspended=503, pending_deletion=410
  │
  ├── Compose: buildRuntimeConfig + merge overrides
  │     └── merge respects binding.allowUi / binding.allowBackend
  │
  ├── Integrity: SRI verification for overridden URLs (unchanged)
  │
  └── SSR: gated by binding.allowSsr
```

### What Gets Removed

- `resolveTenantAccountId` — algorithmic hostname parsing
- `NEAR_ACCOUNT_ID_REGEX` in the host
- `TENANT_WHITELIST` env var
- `ALLOW_OVERRIDE` env var
- `ALLOW_UNTRUSTED_SSR` env var
- `RESERVED_SUBDOMAINS` check in the host (binding table handles conflicts)
- `isRuntimeOverrideAllowed`, `isPluginOverrideAllowed` — replaced by per-tenant DB fields

### What Stays

- `resolveRequestRuntime` signature and return type — same call sites
- Integrity verification (SRI) for overridden URLs
- Config loading from FastKV via `loadRemoteConfig`
- `buildRuntimeConfig` and `buildEffectiveRuntimeConfig` — input now comes from binding fields instead of env vars
- Status gating from published config

### Custom Domain Verification

Custom domains use traditional DNS TXT record verification:

1. User adds custom domain in UI → creates pending `domain_bindings` row
2. Platform returns a verification TXT value (`everything-verify=<random>`)
3. User adds TXT record at their DNS provider
4. API verifies the TXT record → sets `verified_at`
5. Host includes the domain in its next binding map refresh

NEAR DNS (`dns.<account>.near` TXT records) is an additive verification path
for later, reusing the same NEAR identity anchor without introducing new trust
assumptions.

### Infrastructure

- **Wildcard DNS**: `*.everything.dev` → shared host IP. A single wildcard
  SSL certificate covers all tenant subdomains.
- **Custom domains**: Individual certificates per domain (Caddy/nginx handles
  automatic issuance and renewal).
- **Caddy/nginx**: Handle TLS termination, reverse proxying, rate limiting.
  No application-level routing logic — that stays in the host.

## Path → URL Resolution

Bridge from URI descriptors (`local://`, `bos://`) to the concrete URLs the host consumes.
One pure function: `resolveApp(config, ctx)` → `RuntimeConfig`. Output is the existing
`RuntimeConfig` shape the host already reads (`url`, `entry`) — zero host changes.

### Decision: `source` URIs replace hand-written `development`/`production`

Authoring config uses a single `source` URI per entry instead of per-environment URL fields:

| URI | Meaning | Dev `url` | Prod `url` |
|-----|---------|-----------|------------|
| `local://path` | Local workspace | `portMap[path]` → `http://localhost:<port>` | `deployMap[path]` → Zephyr CDN URL |
| `bos://account/domain#field.path` | Published config reference | `localOverrides` → local port, else `extendsResolver` | `extendsResolver` (FastKV — future) |

The resolver populates `url` (base) and `entry` (`url + "/mf-manifest.json"`). No redundant
`src` field — `url` already exists and the host already reads it. `source` is preserved for
traceability but ignored by the host. `name` derives from workspace `package.json#name`,
falling back to the path segment.

### Decision: plugin config gets explicit `api` / `ui` sub-keys

Full-stack plugin has both; UI-only has only `ui`; API-only has only `api`. No implicit
"top-level is the API" convention:

```jsonc
{
  "plugins": {
    "dashboard": { "api": { "source": "local://plugins/dashboard/src" },
                   "ui":  { "source": "local://plugins/dashboard/ui" } },
    "landing":   { "ui":  { "source": "local://web/landing" } },
    "registry":  { "api": { "source": "local://plugins/registry/src" } }
  }
}
```

Tenant override touches only the sub-key it replaces (`plugins.dashboard.ui.source`); the
rest flows through the extends chain.

### Decision: directory convention — `src/` = backend, `ui/` = web, `native/` = RN

Config key ≠ directory name. `source` URI is the path; the key is the role. `src/` stays
`src/` (universal JS convention), `web/` → `ui/` to align with the config key and distinguish
from `native/`:

```
plugins/dashboard/
├── src/          ← backend (api): contract, services, router
├── ui/           ← web frontend (ui): TanStack Router routes
└── native/       ← React Native screens
```

### Decision: entry format is `mf-manifest.json`

rsbuild v2 emits `mf-manifest.json`; `entry = url + "/mf-manifest.json"` for all remotes.
Proven in the web-grafting and override prototypes. Replaces `remoteEntry.js`.

### Decision: generated runtime config carries resolved URLs to the host

Authoring config on disk is never mutated. `bos dev` writes a generated runtime config
(`.bos/runtime-config.toml` — or `bos.config.json` for now) that the host reads. `bos publish`
resolves to CDN URLs and publishes TOML to FastKV.

### Publish flow (`bos publish --deploy`)

```
1. Read bos.config.json (source URIs)
2. Walk local:// entries → build each workspace → deploy to Zephyr → capture CDN URL + integrity
3. resolveApp(config, { mode: "production", deployMap }) → url/entry populated with CDN URLs
4. Serialize resolved TOML → publish to FastKV at bos://<account>/<domain>
5. Prod host reads resolved config from FastKV (existing mechanism)
```

Per-workspace build/deploy reuses the existing `[BOS_DEPLOY]` stdout capture pattern
(`integrity.ts:270`). Each `local://` entry is an independent workspace with its own build and
deploy — a full-stack plugin has two entries (`src/` and `ui/`), two builds, two CDN URLs.

### `bos://` resolution timing

For now, `bos://` refs are resolved **at publish time** to concrete URLs in the published TOML
(simple, host boots fully concrete). The `extendsResolver` strategy slot keeps runtime
re-resolution (cache TTL, auto-sync of base updates to tenants) possible later.

### Integrity

`integrity` is captured at deploy and baked into the published config, but validation is
deferred — the pipeline hardening is a separate concern from resolution.

### Non-goals

- FastKV client (strategy slot only)
- Integrity computation/verification pipeline
- `App()`/`Plugin()`/`WebPlugin()` constructors — `bos.config.json` stays the authoring
  surface for now (`app.ts` deferred)

## Decisions 11–17 — v2 platform services (deploy, sandboxes, upstream)

Decisions from the v2 platform-services pass (deploy/CDN replacement, service
provider, OTA runtime, sandboxes, upstream strategy). They extend decisions
1–10 without reopening them; decision 11 supersedes the Zephyr assumption
baked into decision 9 and every beta-v2 plan doc.

11. **Bundle storage: the everything.dev deploy service replaces Zephyr** —
    a platform plugin (contract/service/index, Drizzle `plugin_deploy` schema)
    on the official deployment. R2/S3 storage via aws4fetch with scoped S3
    tokens, content-hashed paths, explicit MIME map, immutable cache-control.
    Auth = SIWN session or `edk_...` API key (so every deploy route is also an
    MCP tool — agents deploy headlessly). Eligibility = organization membership
    (in-process `pluginsClient` check against the auth plugin; subscriber checks
    slot into the same seam later). Namespaced per account:
    `uploads.<domain>/u/<account>/<workspace>/<bundle-hash>/` for members,
    `cdn.<domain>` for official CI deploys through the same service — only the
    service ever holds CDN credentials. Day-one hardening: streaming uploads,
    per-account quota, file-count cap, MIME allowlist, concurrency limit,
    `X-Robots-Tag: noindex`. A provider seam keeps IPFS viable later: once
    `--watch` hosts cache bundles on local disk at hot-swap time, gateway
    flakiness becomes a one-time cold-fetch cost, not per-request latency.
    Supersedes decision 9's "Zephyr CDN is the content delivery layer" and the
    rejected shared-bucket model from PR #58 (which recreated Zephyr's
    gatekeeping with Cloudflare credentials).

12. **Publish auth: gasless wallet delegate action** — `bos publish` builds a
    FastKV `set_values` delegate action, the user approves in their wallet, and
    the existing ephemeral relayer (NEP-366 pattern) submits it. No keys on
    disk, no `bos key generate` + near-cli for humans. Requires adding the
    FastKV registry contract to the relayer whitelist and sizing gas/deposit
    for ~10KB writes. Function-call keys stay first-class for CI and headless
    agents (the "AI agent signs with its own NEAR key" loop). One transaction
    writes both the config and `deploys/<id>/manifest.json` (on-chain ledger
    mirror of the deploy service's deployment records).

13. **The service provider is one alchemy program** — everything.dev as
    "ultimate server provider" means the provider itself (buckets, sandbox
    machines, DNS) is declared as a single alchemy (Infrastructure-as-Effects)
    program: self-hostable, portable across Cloudflare/Fly/Hetzner, typed
    end-to-end. This is how the Railway/Cloudflare/Zephyr dependency is
    reduced — not by eliminating cloud vendors but by making the provider
    declarative and swappable. Sovereign tenants run the same program on their
    own accounts. Also the fix for the PR #58 alchemy-sandbox pain: the oRPC
    v2 migration lands on Effect 4 (see decision 17 / ticket 07), removing the
    peer-conflict that forced the sandbox.

14. **OTA runtime: `bos start --watch`** — the static container never restarts
    for code changes. It polls the FastKV read URL for its account's config
    (~5s), and on change: validates the trust chain (signed on-chain config +
    per-remote SRI), re-imports MF remotes at new URLs (Node's ESM cache is
    URL-keyed — fresh URLs load fresh modules), destroys old plugin scopes,
    re-initializes, and rolls back to the last-good config on any failure. One
    generic image for every tier (shared host, city node host, sandbox),
    parameterized only by `BOS_ACCOUNT`/`BOS_GATEWAY`. The hard parts (in-flight
    requests, DB pool handoff, ESM disposal) are tracked in ticket 10 and need
    a prototype before implementation.

15. **Sandboxes: per-account containers from the same image** — a sandbox is
    the same static image with `--watch`, serving `<near-id>` subdomains.
    Workshop tier starts as a pre-spawned pool (manually deployed machines +
    wildcard DNS — no orchestrator code) so the demo loop ships before any
    spawn dashboard. A full orchestrator (dashboard + spawn API, alchemy Fly
    Machines / Cloudflare Containers) is a later phase. Sandbox memory floor is
    the app process itself (~300–500MB); the embedded DB adds tens of MB
    (ticket 11); sleep-on-idle makes idle sandboxes ~free. Wildcard TLS:
    DNS-only (grey cloud) CNAME + `_acme-challenge` to the machine host's
    auto-issued Let's Encrypt wildcard — free, any depth, no ACM. Cloudflare's
    free Universal SSL covers first-level subdomains only; second-level
    (`<user>.<city>.<domain>`) requires ACM or grey-cloud bypass.

16. **Tenant databases via alchemy** — completes `toml-infra-alchemy.md`
    Phase 4: `Drizzle.Schema` as an alchemy resource, migrations applied at
    deploy (never runtime), Neon as the provisioning backend. Tiered sandbox
    engines per ticket 11 (PGlite embedded / Neon remote). Sovereign tenants
    provision their own databases with their own alchemy program.

17. **Upstream strategy: this fork is the base** — NEARBuilders/citynode.app
    `main` is ahead of NEARBuilders/everything-dev with platform changes worth
    keeping. v2 platform work lands on a `v2` integration branch cut from this
    fork's `main`; PRs from the branch go up to everything-dev; upstream
    changes merge in; citynode `main` consumes the branch. Opening move on the
    branch: the oRPC v2 + Effect 4 migration (ticket 07) — it is load-bearing
    for every beta-v2 doc, unlocks alchemy as a direct dependency, and its
    atomic-deploy constraint (V1 clients can't talk to V2 servers) is cheapest
    to absorb inside a branch that also ships the new publish pipeline. Then
    the deploy service (built Effect-native from day one), then grafting into
    the real codebase, then the OTA runtime and sandboxes.

## State as of 2026-09

- oRPC v2 + Effect 4 migration **executed** — merged in citynode.app#97, deployed to production (everything-dev#248 epic).
- MF shared-dep version identity guardrails **executed** — citynode.app#106; the runtime bundle identity, the `bos mf check` CLI, the load-path guard, and the deploy-gate all enforce a consistent release train.
- Root-Dockerfile tracking for container tiers — Railway builds from the committed root `Dockerfile`, so the same container translates to any provider (Fly Machines / Hetzner / …) going forward.
- Gasless-auth sprint **scoped** — tickets filed upstream on NEARBuilders/everything-dev (#288 `bos login`, #289 `bos publish --wallet` NEP-366, #290 docs, #291 custody preview via Outlayer), all sprouts of the v2 platform services spec (#274); local sprint files at `.scratch/gasless-auth/`.
- Build-tooling absorption **phase 1 executed** — ADRs 0002-0004 (docs/adr/): rspack plugin stack composed into `every-plugin` (`EveryPluginComposedBuild` + `createPluginBaseConfig`), `every-plugin dev|types|build|deploy` CLI as the plugin package contract, serve bin reduced to a one-line source import. Per-workspace rspack configs, script chains and the dev-serve bin dispatch are gone: workspaces ship zero build config by default (CLI synthesizes the composed stack, opt-in `build.config.ts` overrides). `withPluginDeploy` (integrity) owns the Zephyr/SRI/report seam. Phase 2 (root `app.ts` absorbing `bos.config.json` + `railway.toml`, Effect pipeline) is drafted in ADR 0005 and tracked in `tickets/12-build-tooling-absorption.md`.

## Not yet specified

- Native plugin composition model (React Navigation equivalent of grafting) — depends on #1 route grafting research settling the web pattern first
- Tenant sandboxing verification — depends on #4 SSR per-request composition and #5 tenant data isolation
- Hot-swap mechanism (Phase 9) — direction locked (decision 14: `bos start --watch`, poll FastKV, SRI-validate, swap, rollback); the lifecycle design is tracked in `tickets/10-hot-swap-lifecycle.md` and needs a prototype
- Alchemy DB integration details — direction locked (decision 16 + `tickets/11-sandbox-db.md`); execution completes `toml-infra-alchemy.md` Phase 4
- `composeApp()` implementation details and caching strategy — depends on #4 SSR per-request model
- **Offline shell + data sync** (Layer 1: SW asset caching, Layer 2: IndexedDB mutation queue + replay) — depends on the host's MF loading pattern and shell HTML rendering settling first (Phase 2). The SW is a standalone `host/src/sw.ts` compiled as a second rsbuild entry, served at `/sw.js`. Layer 1 caches `remoteEntry.js`, plugin UI entries, and static files via structural URL patterns — no knowledge of plugin internals. Layer 2 adds a generic request queue for offline mutations, consumed by UI hooks via `postMessage`. Both tracked in `../offline/shell-sw-caching.md` and `../offline/data-sync-queue.md`. Open questions: SSR-rendered pages offline (shell fallback vs full content); `BackgroundSync` API vs periodic poll for queue replay; SW cache size/budget.

## Locale & Internationalization

### Decision: locale is a host concern, not a plugin concern

The host owns the locale URL layer. Plugins declare mount points (`_public`,
`_authenticated`) exactly as they do today — no locale awareness in the plugin
tree. The compose loop optionally inserts a `$locale` layout route between the
root route and all mount points, controlled by app config. Plugins consume
locale via router context, not URL structure.

Rationale:
- **Single-language apps stay simple** — no locale config → no `$locale` in the
  route tree → plugin absolute paths (`/about`) work as they do in the prototype.
- **Multi-language apps get locale transparently** — locale config present →
  `$locale` inserted above mounts → plugin relative paths (`./about`) resolve to
  `/$locale/about` with zero plugin code changes.
- **One compose loop, two modes** — one `if` statement in `composeApp` determines
  the parent route for all mounts. The grafting engine, mount registry, ID
  namespacing, and auth gates are unchanged.
- **Plugin file-based devs never create `$locale` directories** — the locale
  prefix is injected by the host, not authored in plugin `src/routes/`.

### Decision: path-based locale, subdomain stays for tenants

Subdomains already carry tenant identity (`pizza.everything.dev`). Adding locale
to subdomains would create `en.pizza.everything.dev` × N tenants × M locales —
DNS and TLS certificate explosion. Path-based locale keeps DNS flat:

```
# Single-language app (no locale config)
pizza.everything.dev/about
pizza.everything.dev/dashboard

# Multi-language app (locales: en, fr, es)
pizza.everything.dev/en/about
pizza.everything.dev/fr/about
pizza.everything.dev/es/about
```

The root `/` with no locale prefix serves a locale detection page (browser
`Accept-Language` → redirect to `/$locale/`). For simple single-language apps
with no locale config, `/` is a normal page — no redirect, no locale prefix
ever appears.

### URL structure by mode

| Config | URL | Route tree | Plugin path convention |
|--------|-----|------------|----------------------|
| No locales | `/about` | `rootRoute → _public → /about` | Absolute (`/about`) works; relative (`./about`) also works |
| `locales: ["en", "fr"]` | `/en/about` | `rootRoute → $locale → _public → /about` | Relative (`./about`) required; absolute breaks |
| Default locale `en` | `/en/about` | Same as above | Same as above |

In single-locale mode, plugins can use absolute paths because there's no locale
prefix to account for. Relative paths are a best practice that works in both
modes, but not a requirement for apps with no locale config.

### Compose loop change

One conditional insertion of the `$locale` layout. Everything else is identical:

```typescript
function composeApp(plugins: WebPluginModule[], config: AppConfig): ComposedApp {
  const rootRoute = createRootRoute({
    component: () => (
      <div>
        <HostShell />     {/* nav, locale picker, user menu */}
        <Outlet />
      </div>
    ),
  })

  // If locales configured, insert $locale layout between root and all mounts.
  // If not, mounts are direct children of rootRoute — no locale prefix exists.
  let mountParent: AnyRoute = rootRoute
  if (config.locales?.length) {
    mountParent = createRoute({
      getParentRoute: () => rootRoute,
      path: '$locale',
      loader: ({ params }) => {
        const locale = params.locale
        if (!config.locales.includes(locale)) {
          throw redirect({ to: config.defaultLocale ? `/${config.defaultLocale}` : `/${config.locales[0]}` })
        }
        return { locale }
      },
    })
  }

  const mountRegistry = createMountRegistry(mountParent)
  // ... grafting loop unchanged
}
```

The `$locale` route validates the locale param against the configured list and
redirects invalid locales to the default. The locale is passed to the router
context — every plugin route under any mount can consume it.

### `createMountRegistry` change

Mount routes accept a parent route parameter instead of hardcoding `rootRoute`:

```typescript
function createMountRegistry(parentRoute: AnyRoute): Record<string, MountEntry> {
  const publicMount = createRoute({
    getParentRoute: () => parentRoute,     // was: () => rootRoute
    id: '_public',
    component: () => <MountChrome mountId="public" />,
    // ... auth gates, SSR policy unchanged
  })
  // ... authenticatedMount, adminMount, etc. — all parented to parentRoute
}
```

This is the only change. The mount's auth gates (`beforeLoad`), SSR policy
(`ssr: false` for session-gated mounts), and component chrome are untouched.

### `useLocale()` hook

Provided by the host via TanStack Router context. Plugins consume it without
knowing how locale is determined:

```typescript
// host/src/locale.tsx
import { type UseLocale, createLocaleContext } from './locale-context'

export function useLocale(): UseLocale {
  const { locale } = useRouterState({ select: (s) => s.location.state.locale })
  return {
    locale: locale ?? 'en',                    // falls back for single-locale mode
    locales: ['en', 'fr'] as const,            // from config
    defaultLocale: 'en',                       // from config
  }
}
```

For single-language apps with no locale config, `useLocale()` returns the
configured default (`'en'`) and an empty or single-entry `locales` array.
Plugins can safely call `useLocale()` without guarding for locale mode.

### Plugin dev experience

**File-based routing (single- or multi-language, identical structure):**

```
plugins/landing/
  src/
    routes/
      __root.tsx                 ← plugin root
      _public.tsx                ← mount declaration (pathless)
      _public/
        about.tsx                ← renders at /about OR /$locale/about
        blog/
          index.tsx              ← renders at /blog OR /$locale/blog
          $postId.tsx            ← renders at /blog/$postId OR /$locale/blog/$postId
    i18n/
      en.json                    ← plugin-owned translations
      fr.json                    ← plugin-owned translations
```

**Route component (locale-aware):**

```typescript
// plugins/landing/src/routes/_public/about.tsx
import { useLocale } from '@host/locale'

export const Route = createFileRoute('/_public/about')({
  component: AboutPage,
})

function AboutPage() {
  const { locale } = useLocale()
  const t = await queryClient.fetchQuery({
    queryKey: ['i18n', locale, 'about'],
    queryFn: () => import(`../i18n/${locale}.json`),
  })

  return (
    <div>
      <h1>{t.title}</h1>
      <p>{t.description}</p>
      <Link to=".">Home</Link>          {/* relative, works in both modes */}
      <Link to="./blog">Blog</Link>     {/* relative, works in both modes */}
    </div>
  )
}
```

**Navigation rules for plugins:**

| Scenario | Pattern | Works in single-locale? | Works in multi-locale? |
|----------|---------|------------------------|------------------------|
| Within-plugin, same mount | `to="./about"` | Yes | Yes |
| Within-plugin, same mount | `to="/about"` | Yes | No (missing `$locale`) |
| Cross-plugin, same mount | `to="../other/page"` | Yes | Yes |
| Cross-plugin, different mount | `<a href="/settings">` | Yes | Needs `$locale` prefix |

Cross-plugin navigation across mount types (e.g., public → authenticated) uses
bare `<a>` hrefs today in the prototype, which cause a full page load. This
works regardless of locale mode — the server handles the locale prefix. A
future `useAppLink()` hook could provide typed, locale-aware cross-plugin links.

### Translation ownership

Translations are **plugin-owned**, not platform-owned. Each plugin ships its own
`i18n/` directory with JSON files per locale. No global translation registry.
No shared message keys across plugins. This mirrors the Module Federation
boundary — a plugin's runtime code, routes, and strings are a single deployable.

```
plugins/landing/ui/i18n/en.json    ← { "about.title": "About Us", ... }
plugins/landing/ui/i18n/fr.json    ← { "about.title": "À propos", ... }
plugins/dashboard/ui/i18n/en.json  ← { "analytics.title": "Analytics", ... }
plugins/dashboard/ui/i18n/fr.json  ← { "analytics.title": "Analytique", ... }
```

A shared i18n utility module (`dev.everything.near/i18n`) could provide
`useTranslation()`, ICU message formatting, pluralization, and RTL support, but
it's an optional dependency — plugins can roll their own or use none at all.
The host does not mandate an i18n framework.

### SSR implications

Locale detection for SSR follows the same exclusion strategy as auth gates.
Public mounts (`_public`, `anon`) SSR fully and can render locale-aware content
because `$locale` is a path segment — the server knows the locale from the URL.

Session-gated mounts (`_authenticated`, `_admin`, `_organization`) are
`ssr: false` — the server renders nothing for those subtrees, same as today.
This means server-side locale detection for authenticated content is irrelevant
(vs. client-side where `useLocale()` works after hydration).

For the root `/` (no locale prefix), the server reads `Accept-Language` from
the request header and responds with a 302 redirect to `/$bestLocale/`. This is
a server concern, not a router concern — the Hono host handles it before
TanStack Router sees the request.

### Functional divergence per locale vs i18n

Displaying translated text (i18n) and offering different functionality per
locale (payments, shipping, legal compliance) are separate concerns:

| Concern | Mechanism | Owner |
|---------|-----------|-------|
| Translated strings | `useLocale()` + plugin `i18n/` | Plugin |
| Different payment providers | Module composition (`depends_on`) | App config |
| Different feature flags | Module composition | App config |
| RTL layout | CSS direction from `useLocale()` | Plugin |

If a French tenant needs Adyen instead of Stripe, that's a module swap in the
app's composition config — the French app composes `pizza.near/payment-adyen`,
the English app composes `pizza.near/payment-stripe`. No locale-aware branching
in plugin code.

### Open questions

- **Locale picker UI** — host shell component? Plugin-provided? Host owns the
  shell with a slot for plugin customization.
- **Sub-path locale vs separate locale route for default** — should the default
  locale ALSO have a prefix (`/en/about`), or should default locale omit the
  prefix (`/about`)? The compose loop supports both; the config decides.
  Prefix-always is simpler and more consistent; prefix-optional is friendlier
  for single-language apps. Recommendation: prefix-always when `locales` is
  configured, no prefix when `locales` is absent (single-language).
- **Cross-plugin typed navigation with locale** — a `useAppLink()` hook that
  resolves plugin+route to a locale-aware URL. Depends on typed route resolution
  across Module Federation boundaries (a Phase 3 `app.ts` concern).

## Out of scope

- Native plugin (React Native, Re.Pack) implementation — separate effort, only the composability model is in-view
- Tenant infrastructure provisioning (Neon branches, Railway deploys) — operational concern, not an architectural decision
- Migration tooling for existing child repos — implement after architecture is ratified
- CI/CD pipeline changes — follow the architecture, don't lead it
