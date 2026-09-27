# everything.dev v2 — Tenant Architecture

## Vision

Every deployment is a verifiable claim on NEAR. A tenant can start as a lightweight subdomain
override on the shared host, graduate to their own domain with process isolation, and eventually
run their own backend plugins — all using the same `app.ts` surface and the same extends chain.
No rewrite. No migration. The deployment graph is on-chain and auditable.

## Design Principles

1. **Verifiable lineage** — every published config on FastKV is a deployment manifest. The
   extends chain is a cryptographic proof of provenance.
2. **Progressive sovereignty** — tenants start simple (subdomain, UI-only), upgrade to
   sovereign (own host, own DB, own plugins) without changing their `app.ts` surface.
3. **Sandbox by default** — web code runs in the browser (sandboxed). Backend code runs in the
   tenant's own process (process isolation). The shared host never loads untrusted backend code.
4. **Data isolation by tier** — shared-host tenants get schema-level isolation. Sovereign
   tenants get their own database.
5. **Self-deploying by design** — `bos init` + `bos publish --deploy` produces a fully
   independent deploy. The shared host is a convenience, not a requirement.
6. **Data-driven routing** — hostnames resolve to configs via a `domain_bindings` database
   table, not by parsing hostnames algorithmically. A subdomain can be a tenant, a standalone
   app, or a custom domain — all through the same lookup. Permissions (`allow_ui_overrides`,
   `allow_backend_overrides`, `allow_ssr`) live on the tenant record, not in host env vars.

## The Three Tenant Tiers

| | Tier 1: Lightweight | Tier 2: Sovereign Light | Tier 3: Sovereign Full |
|---|---|---|---|
| **Domain** | Subdomain (`chicago.citynode.app`) | Any domain (`superagency.ai`) | Any domain |
| **Host** | Shared | Own deploy | Own deploy |
| **Web overrides** | Yes (browser sandbox) | Yes (browser sandbox) | Yes |
| **Backend plugins** | No (base only) | Base plugins only | Base + custom plugins |
| **Database** | Shared, schema-isolated | Own Neon branch | Own Neon project |
| **Sandbox** | Browser (web), none (API — gated) | Process (full) | Process (full) |
| **Infra cost** | Zero ($0) | ~$5/mo (host + DB) | ~$10/mo (host + DB) |
| **Setup time** | 5 minutes | 15 minutes | 30 minutes + custom code |

### Tier 1: Lightweight (Shared Host, Subdomain)

The tenant publishes a config that overrides specific UI plugin URLs. The shared host resolves
the tenant at request time via a cached `BindingResolver` that reads from the API's
`domain_bindings` table — not by parsing the hostname algorithmically. Zero infrastructure.
No backend code runs in the shared host process from untrusted tenants.

```
chicago.citynode.app  → shared host
  lookup:  BindingResolver.resolve("chicago.citynode.app")
           → { configAccount: "chicago.citynode.near", configGateway: "citynode.app",
               allowUi: true, allowBackend: false, allowSsr: false }
  fetches:  bos://chicago.citynode.near/citynode.app
  verifies: extends chain → bos://citynode.near/citynode.app ✓
  composes: chicago's landing UI + citynode's dashboard, auth, admin
  serves:   chicago-branded experience
```

```typescript
// chicago app.ts
export default App({
  account: "chicago.citynode.near",
  domain: "chicago.citynode.app",
  extends: "bos://citynode.near/citynode.app",

  web: {
    landing: WebPlugin("landing").path("web/chicago-landing"),
    // dashboard, admin, auth-web: inherited from citynode
  },
});
```

Sandboxing: the tenant's UI code runs in the visitor's browser. The browser's same-origin
policy prevents it from accessing other tenants' data. MF shared singletons (React, Router,
QueryClient) are the same version across all tenants — there is no mechanism for a tenant's UI
to override or intercept another tenant's data fetches, because each tenant gets a distinct
`apiClient` scoped to their session and tenant context. Cross-tenant data access would require
the shared host's API to return data for the wrong tenant, which is a server-side concern
handled by the host's tenant resolution logic.

The shared host NEVER loads tenant backend code by default. Each tenant record has
`allow_ui_overrides` (default `true`) and `allow_backend_overrides` (default `false`).
To enable backend plugins for a tenant, an admin sets `allow_backend_overrides = true` on
that tenant's record. The host reads these flags from the `BindingResolver` on every
request — no host env vars, no process restart.

### Tier 2: Sovereign Light (Own Host, Own DB)

The tenant deploys their own host process. The host code is identical to the base host — the
difference is the config it loads. The tenant's host boots, fetches the base config from
`extends`, fetches the tenant's published config, and composes the app. The tenant has their
own database (a Neon branch of the base DB).

```
superagency.ai  → tenant's own Railway deploy
  host boots:
    fetches:  bos://multiagency.near/multiagency.ai    (base config)
    fetches:  bos://superagency.near/superagency.ai    (tenant config)
    verifies: extends chain ✓
    composes: superagency's landing + multiagency's dashboard, auth, admin
    connects: own DATABASE_URL (Neon branch)
    serves:   superagency-branded experience on superagency.ai
```

```typescript
// superagency app.ts (same surface as Tier 1)
export default App({
  account: "superagency.near",
  domain: "superagency.ai",
  extends: "bos://multiagency.near/multiagency.ai",

  web: {
    landing: WebPlugin("landing").path("web/super-landing"),
  },
});
```

```bash
# Tenant setup
bos init --extends bos://multiagency.near/multiagency.ai
bos publish --deploy
# → builds web plugins, deploys to Zephyr, publishes config
# → provisions Neon branch, runs migrations

# Deploy host to Railway
railway up
# → host boots, loads config, serves superagency.ai
```

Process isolation: the tenant's host runs as a separate process on separate infrastructure.
A compromised tenant host cannot access the base platform's database, secrets, or other
tenants' data. The extends chain ensures the tenant's host can only load verified remotes
from the base platform.

### Tier 3: Sovereign Full (Own Host, Own Backend)

The tenant adds custom backend plugins. Their host loads base plugins from the extends chain
plus tenant-specific plugins from their own workspace.

```typescript
// city-analytics app.ts
export default App({
  account: "analytics.citynode.near",
  domain: "analytics.citynode.near",
  extends: "bos://citynode.near/citynode.app",

  plugins: {
    // Inherited from base
    auth: Plugin("auth").extends("base"),
    dashboard: Plugin("dashboard").extends("base"),

    // Tenant's own backend plugins
    reports: Plugin("reports").path("plugins/reports"),
    alerts: Plugin("alerts").path("plugins/alerts"),
  },

  web: {
    dashboard: WebPlugin("dashboard").path("web/analytics-dashboard"),
    reports: WebPlugin("reports").path("plugins/reports/web"),
  },
});
```

The tenant's `DATABASE_URL` points to their own Neon project with base tables (inherited)
plus tenant-specific tables (reports, alerts). Per-plugin Postgres schemas ensure no naming
collisions: `plugin_dashboard.*`, `plugin_reports.*`, `plugin_alerts.*`.

## Data Isolation

### Per-Tenant Schema Isolation (Tier 1 — Shared Host)

Shared-host tenants share a database with schema-level isolation:

```sql
-- Per-plugin-per-tenant Postgres schemas
CREATE SCHEMA tenant_chicago_plugin_landing;
CREATE SCHEMA tenant_nyc_plugin_landing;
CREATE SCHEMA tenant_chicago_plugin_dashboard;
CREATE SCHEMA tenant_nyc_plugin_dashboard;
```

The host injects a `search_path` scoped to the tenant at request time. Drizzle queries are
automatically routed to the correct schema. A bug in query construction cannot accidentally
cross tenant boundaries because Postgres enforces schema isolation at the database level.

```typescript
// Tenant-aware DB access via Effect
const db = yield* Database;
// Db is scoped to tenant_chicago_plugin_dashboard.*
// SELECT * FROM dashboard_stats → resolves to tenant_chicago_plugin_dashboard.dashboard_stats
```

### Per-Tenant Database (Tier 2 & 3 — Sovereign)

Sovereign tenants get their own Neon project or branch. The `DATABASE_URL` in their `.env`
points to their own database. No shared data surface. Migrations run independently.

```
Tier 1: shared DB → schema isolation
  DATABASE_URL = postgres://shared-host.neon.tech/everything_dev
  search_path = tenant_chicago_plugin_dashboard, tenant_chicago_plugin_landing, ...

Tier 2: Neon branch from base
  DATABASE_URL = postgres://tenant-chicago.neon.tech/citynode
  → branch of base DB, schema already migrated, data independent

Tier 3: Own Neon project
  DATABASE_URL = postgres://superagency.neon.tech/superagency
  → independent project, own migrations, own extensions
```

## Verifiable Deployment Graph

Every published config on FastKV is a verifiable deployment manifest. The extends chain creates
a cryptographic lineage:

```
bos://superagency.near/superagency.ai
  ├── integrity: { landing: "sha384-abc123...", dashboard: "sha384-def456..." }
  ├── extends: bos://multiagency.near/multiagency.ai
  │     ├── integrity: { dashboard: "sha384-ghi789...", auth: "sha384-jkl012..." }
  │     ├── extends: bos://auth.near/auth.dev
  │     │     └── integrity: { auth: "sha384-mno345..." }
  │     └── ...
  └── ...
```

The host verifies on every request:
1. The tenant's config was published by the correct NEAR account
2. The config's `extendsChain` includes the expected base runtime
3. Every remote's integrity hash matches the published hash
4. The tenant hasn't modified inherited remotes' hashes

```typescript
// host/src/services/tenant-runtime.ts
async function resolveRequestRuntime(baseConfig, request) {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();

  // 1. Resolve hostname → config location (data-driven, no algorithmic derivation)
  const binding = yield* BindingResolver.resolve(hostname);
  if (!binding) {
    return { config: baseConfig, tenantAccountId: null, gatewayId, ssrAllowed: ... };
  }

  // 2. Fetch tenant config from on-chain registry
  const bosUrl = `bos://${binding.configAccount}/${binding.configGateway}`;
  const remoteConfig = await getRemoteConfigCached(bosUrl);

  // 3. Check status from binding (DB-backed, not just published config)
  if (binding.status === "suspended") {
    throw new TenantRuntimeError("Tenant is suspended", 503);
  }
  if (binding.status === "pending_deletion") {
    throw new TenantRuntimeError("Tenant has been deleted", 410);
  }

  // 4. Build composed config with permission gating from binding
  const effectiveConfig = composeConfig(baseConfig, remoteConfig, {
    allowUi: binding.allowUi,
    allowBackend: binding.allowBackend,
  });

  // 5. Verify integrity of all overridden remotes (unchanged)
  for (const [name, url] of resolvedPlugins.overrides) {
    await verifyIntegrity(url, remoteConfig.rawConfig.web?.plugins?.[name]?.integrity);
  }

  // 6. SSR gated by binding.allowSsr
  const ssrAllowed = Boolean(effectiveConfig.ui.ssrUrl) && binding.allowSsr;

  return { config: effectiveConfig, tenantAccountId: binding.configAccount, gatewayId, ssrAllowed };
}
```

## Worked Examples

### City Node Platform

```
Deployment graph:
  bos://citynode.near/citynode.app                  ← base platform
    domain: citynode.app
    ui: landing, dashboard, admin, auth-ui
    plugins: auth, dashboard, maps, events

  bos://chicago.citynode.near/citynode.app           ← Tier 1 (shared host)
    domain: chicago.citynode.app
    extends: bos://citynode.near/citynode.app
    web: landing = https://chicago-landing.zephyr.app
    # dashboard, admin: inherited

  bos://nyc.citynode.near/citynode.app               ← Tier 1
    domain: nyc.citynode.app
    extends: bos://citynode.near/citynode.app
    web: landing = https://nyc-landing.zephyr.app

  bos://la.citynode.near/lacity.gov                   ← Tier 2 (own host)
    domain: lacity.gov
    extends: bos://citynode.near/citynode.app
    web: landing = https://la-landing.zephyr.app
    web: dashboard = https://la-dashboard.zephyr.app   ← custom dashboard
    host: https://la-host.railway.app
```

```typescript
// chicago citynode tenant (Tier 1 — 5 minute setup)
export default App({
  account: "chicago.citynode.near",
  domain: "chicago.citynode.app",
  extends: "bos://citynode.near/citynode.app",
  web: {
    landing: WebPlugin("landing").path("web/chicago"),
  },
});

// la citynode tenant (Tier 2 — own domain, own host)
export default App({
  account: "la.citynode.near",
  domain: "lacity.gov",
  extends: "bos://citynode.near/citynode.app",
  web: {
    landing: WebPlugin("landing").path("web/la-landing"),
    dashboard: WebPlugin("dashboard").path("web/la-dashboard"),
  },
  host: "host/src",  // own host deploy
});
```

### Marketplace Platform

```
Deployment graph:
  bos://artmarket.near/artmarket.app                  ← base marketplace
    domain: artmarket.app
    web: catalog, cart, checkout, admin, auth-web
    plugins: auth, catalog, orders, payments

  bos://janes-gallery.artmarket.near/artmarket.app    ← Tier 1 gallery
    domain: janes-gallery.artmarket.app
    extends: bos://artmarket.near/artmarket.app
    web: landing = jane's storefront
    # catalog, cart, checkout: inherited

  bos://premium-art.artmarket.near/premium-art.com     ← Tier 2 gallery
    domain: premium-art.com
    extends: bos://artmarket.near/artmarket.app
    web: landing = premium storefront
    web: dashboard = custom analytics dashboard
    host: own Railway deploy
```

```typescript
// janes-gallery tenant (Tier 1)
export default App({
  account: "janes-gallery.artmarket.near",
  domain: "janes-gallery.artmarket.app",
  extends: "bos://artmarket.near/artmarket.app",
  web: {
    landing: WebPlugin("landing").path("web/janes-storefront"),
  },
});

// premium-art tenant (Tier 2)
export default App({
  account: "premium-art.artmarket.near",
  domain: "premium-art.com",
  extends: "bos://artmarket.near/artmarket.app",
  web: {
    landing: WebPlugin("landing").path("web/premium-storefront"),
    dashboard: WebPlugin("dashboard").path("web/premium-analytics"),
  },
  host: "host/src",
});
```

### Agency/Client Platform

```
Deployment graph:
  bos://multiagency.near/multiagency.ai               ← base agency
    domain: multiagency.ai
    web: landing, dashboard, admin, auth-web
    plugins: auth, dashboard, projects, analytics

  bos://client1.multiagency.near/multiagency.ai       ← Tier 1 client
    domain: client1.multiagency.ai
    extends: bos://multiagency.near/multiagency.ai
    web: landing = client's own marketing site
    # dashboard: inherited (agency manages campaigns)

  bos://bigcorp.multiagency.near/bigcorp.com          ← Tier 2 client
    domain: bigcorp.com
    extends: bos://multiagency.near/multiagency.ai
    web: landing = bigcorp's corporate site
    plugins:
      reports = bigcorp's custom reporting backend
    host: own Railway deploy
```

## Sandboxing Guarantees

| Code execution context | Isolation mechanism | Default policy |
|---|---|---|
| **Tenant web** (MF remote in browser) | Browser same-origin policy, CSP | Always allowed |
| **Tenant API plugins** (shared host) | Gated by `allow_backend_overrides` on tenant record | Disabled by default |
| **Tenant host** (own deploy) | Separate process, separate infra, separate DB | Always allowed |

No tenant backend code runs in the shared host process by default. To enable tenant backend
plugins, set `allow_backend_overrides = true` on that tenant's record in the database.

For the verifiable internet vision, Tier 2/3 (sovereign) is the default for production tenants.
Tier 1 (lightweight) is for development, testing, and small tenants that don't need backend
customization. The platform encourages tenants to graduate to their own host as they grow.

## Tenant Lifecycle

```
bos init
  → prompts: account, domain, extends
  → scaffolds: host/, web/, app.ts
  → Tier 2 ready by default

Tier 1 upgrade to Tier 2:
  bos init (already done if starting from Tier 2 template)
  railway up
  → update DNS
  → tenant now serves from own host

Tier 2 upgrade to Tier 3:
  → add backend plugin: bos plugin add reports
  → implement services
  → bos publish --deploy
  → tenant now serves own backend
```

No migration between tiers. The `app.ts` surface is identical. Tiers differ only in
infrastructure: where the host runs and which database it connects to.

## Sync Model

| Update type | Tier 1 (shared host) | Tier 2/3 (own host) |
|---|---|---|
| Base publishes new dashboard | Automatic — 30s cache TTL picks up new URL | Automatic — 30s cache TTL on extends config |
| Base publishes new auth plugin | Automatic | Automatic |
| Base publishes new backend plugin | Automatic | Automatic |
| Base publishes breaking API change | Tenant UI may break | Tenant UI may break |
| Base publishes new host version | N/A (shared host) | Tenant must `bos upgrade` and redeploy |

For Tier 2/3, the extends chain handles backend sync automatically. Web plugin URLs are fetched
from the latest config on every cache refresh. Only the HOST CODE itself requires manual
upgrades — and only if the base changes the host's runtime behavior (CSP policies, routing
logic, etc.), which should be rare and versioned.

## Host Configuration

### Shared Host (Tier 1 tenants)

```toml
# Shared host's bos.config.toml (base platform)
account = "citynode.near"
domain = "citynode.app"

[app.web]
path = "host"

[plugins]
auth = { extends = "bos://auth.near/auth.dev#app.auth" }
dashboard = { path = "plugins/dashboard" }
maps = { path = "plugins/maps" }
events = { path = "plugins/events" }

# Tenant permissions are managed per-tenant in the database (tenants table):
#   allow_ui_overrides      — default true
#   allow_backend_overrides  — default false
#   allow_ssr               — default false
# No host-level env vars for tenant gating.
```

### Tenant Host (Tier 2/3)

```toml
# Tenant's published config (auto-generated by bos publish --deploy)
account = "chicago.citynode.near"
domain = "chicago.citynode.app"

extends = "bos://citynode.near/citynode.app"

[web.plugins.landing]
production = "https://chicago-landing.uuid.zephyr.app"
integrity = "sha384-abc123..."
```

The tenant config only contains what the tenant OVERRIDES. Everything else is resolved from
the extends chain at boot time.

## Custom Domains

Tenants can bring their own domain (`pizza.com`) in addition to or instead of
their platform subdomain. The mechanism:

1. **User adds domain** in the tenant settings UI → creates a `domain_bindings` row
   with `verified_at = null` and a random verification token
2. **Platform shows verification instructions**: "Add TXT record `everything-verify=<token>`
   to your DNS for `pizza.com`"
3. **User adds TXT record** at their DNS provider (Cloudflare, Route53, Namecheap, etc.)
4. **API verifies**: periodic or on-demand check of the TXT record → sets `verified_at`
   and the binding becomes active
5. **Host picks it up**: on next binding map cache refresh (30s TTL), the custom domain
   resolves to the tenant's config

For domain ownership verification via NEAR DNS (additive path, future):
the user sets a TXT record on `dns.pizza.near` instead of traditional DNS,
reusing the same NEAR identity anchor without introducing new trust assumptions.

### Database Schema

```sql
CREATE TABLE domain_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  hostname TEXT NOT NULL UNIQUE,          -- "pizza.everything.dev" or "pizza.com"
  is_primary BOOLEAN DEFAULT false,       -- canonical subdomain for the tenant
  verification_token TEXT,                -- random token for DNS TXT verification
  verified_at TIMESTAMPTZ,                -- null = pending
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Per-tenant permissions (replaces TENANT_WHITELIST / ALLOW_OVERRIDE env vars)
ALTER TABLE tenants ADD COLUMN allow_ui_overrides BOOLEAN DEFAULT true;
ALTER TABLE tenants ADD COLUMN allow_backend_overrides BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN allow_ssr BOOLEAN DEFAULT false;
```

### API Endpoint

`GET /tenants/bindings` — public, returns all verified bindings for the gateway:

```typescript
output: z.array(z.object({
  hostname: z.string(),
  configAccount: z.string(),
  configGateway: z.string(),
  allowUi: z.boolean(),
  allowBackend: z.boolean(),
  allowSsr: z.boolean(),
  status: TenantStatusSchema,
}))
```

### Binding Resolver (Host)

```typescript
// host/src/services/binding-resolver.ts

interface BindingEntry {
  configAccount: string
  configGateway: string
  allowUi: boolean
  allowBackend: boolean
  allowSsr: boolean
  status: TenantStatus
}

class BindingResolver extends Context.Tag("host/BindingResolver")<
  BindingResolver,
  BindingResolver
>() {
  resolve(hostname: string): BindingEntry | null
  refresh(): Effect<void>
}
```

The host fetches the full binding map on boot and refreshes every 30s.
`resolve()` is an O(1) map lookup — no API call per request.

## Implementation Phases

### Phase 1: Domain Binding & Resolution

- Add `domain_bindings` table and `allow_*` columns to `tenants`
- Add `GET /tenants/bindings` public endpoint
- Add `BindingResolver` service to host (cached, 30s TTL)
- Migrate `resolveRequestRuntime` to use `BindingResolver` instead of `resolveTenantAccountId`
- Remove `TENANT_WHITELIST`, `ALLOW_OVERRIDE`, `ALLOW_UNTRUSTED_SSR` env vars
- Remove `resolveTenantAccountId`, `NEAR_ACCOUNT_ID_REGEX` from host
- Tier 1 tenants get the full web plugin composition model
- Backwards compat: populate `domain_bindings` from existing `tenants` rows on migration

### Phase 2: Data Isolation

- Per-tenant-per-plugin Postgres schema isolation
- `search_path` injection at request time
- Neon branch provisioning for Tier 2 tenants

### Phase 3: Sovereign Tenant Host

- `bos init` scaffolds full host deploy
- Tenant host boots from extends chain
- Tenant host connects to own database
- `bos publish --deploy` provisions Neon branch and deploys host

### Phase 4: Verifiable Deployment Graph

- Extends chain verification in host
- Integrity verification for all overridden remotes
- On-chain deployment manifest with full integrity tree
- Tooling to audit extends chain: `bos verify tenant-account`

## Prototype

A runnable prototype in [beta-v2-override-prototype/](../prototypes/beta-v2-override/)
validates the tenant UI override composition model — a host composing base
platform remotes alongside tenant-specific override remotes, where a tenant
overrides individual UI plugins while inheriting the rest from the base.

## Dependencies

- Web plugin composition model ([ui.md](./ui.md))
- Native plugin composition model ([native.md](./native.md))
- FastKV config publishing (exists today)
- `tenant-runtime.ts` refactor (leanification)
- Per-plugin Postgres schemas (Alchemy/Drizzle)
- `composeApp()` generic host (Phase A of `ui.md`)
