# TanStack Router + Module Federation — Plugin Override Prototype

Runnable proof for the **plugin override model**: "use the dashboard plugin's API,
but with MY OWN dashboard UI."

Builds on the web-grafting prototype (`../beta-v2-prototype/`), which proved route
tree grafting. This prototype proves the **composition model** that surrounds it:

- **API and UI are independently addressable** under the same plugin namespace.
  A tenant swaps only the dashboard UI; the dashboard API is inherited unchanged.
- **One global `apiClient`** is injected into router context by the host and flows
  to every federated UI component via `useRouteContext()` — including UI-only
  plugins accessing *another* plugin's API.
- **`composeApp()` is source-agnostic** — it receives the same `{ name, tree }`
  shape from base and tenant remotes and produces identical route ids/mounts.
- **Path-to-URL resolution bridge** (`host/src/resolver.ts`) — authoring uses
  `source` URIs (`local://path`, `bos://account/domain#path`); `resolveApp()`
  turns them into concrete remote URLs. Dev → `http://localhost:<port>`;
  production → CDN URL from a deploy map. This is the prototype stand-in for
  `packages/everything-dev/src/resolver.ts` (see `plans/wayfinder/beta-v2-map.md`
  → Path → URL Resolution).

map to resolved `AppConfig` (`{ api, ui }` arrays) via `resolveApp()`:

```
base:   api { dashboard: base-api }   ui { dashboard: base-ui,   landing }
tenant: api { dashboard: base-api }   ui { dashboard: tenant-ui, landing }
```

## Packages

| Package | Port | Exposes | Role |
|---|---|---|---|
| `host` | 3000 | — | composes configs, injects apiClient, `?config=` selects base/tenant |
| `remote-dashboard-api` | 3101 | `./api` | the dashboard backend (`getStats`, `listItems`) — SHARED by both configs |
| `remote-dashboard-ui` | 3102 | `./tree` | the DEFAULT dashboard frontend (marker `dashboard-base`) |
| `remote-landing` | 3103 | `./tree` | UI-only plugin; calls `apiClient.dashboard.*` to prove cross-access |
| `remote-tenant-dashboard-ui` | 3104 | `./tree` | the TENANT's dashboard frontend (marker `dashboard-tenant`, adds `/dashboard/revenue`) |

## Quick start

```bash
bun install
```

Headless verify (no servers needed — imports remote source directly):

```bash
bun run verify                 # base config: default dashboard UI + apiClient injection
bun run verify:resolver        # source URIs → concrete URLs (dev, prod, bos:// strategy)
bun run verify:tenant          # tenant config: swapped UI, shared API, landing unchanged
bun run verify:api-injection   # one apiClient reaches base UI, tenant UI, AND landing
bun run verify:compose-shared  # composeApp is source-agnostic (same ids from both remotes)
```

Live Module Federation test (5 dev servers, then headless Chrome via CDP):

```bash
bun run dev
# terminal 2:
bun run verify:browser   # boots base + tenant in a real browser over MF, asserts markers + stats
```

Manual browser check: http://localhost:3000/?config=base renders "BASE UI";
`?config=tenant` renders "TENANT UI". `/dashboard/revenue` exists ONLY in tenant
mode; `/dashboard/analytics` only in base mode.

## What each verify proves

| Script | Proves |
|---|---|
| `verify` | Base app composes; dashboard renders default UI; apiClient flows into dashboard + landing |
| `verify:resolver` | `local://` resolves to dev ports / prod CDN URLs; `bos://` delegates to extendsResolver strategy; `bos://account/domain#field` parses correctly |
| `verify:tenant` | Tenant swaps ONLY the dashboard UI; shared API still returns data; landing inherited unchanged; tenant-only route exists |
| `verify:api-injection` | The same `apiClient` object reaches base UI, tenant UI, and a UI-only plugin — the injection is global, not per-plugin |
| `verify:compose-shared` | `composeApp()` produces identical route ids/branches from base and tenant remotes — no composition change needed for overrides |

## Architecture notes

- **Plugin surface is one `tree` export.** Base and tenant dashboard remotes both
  expose `./tree` with a `_public` pathless layout; the host auto-namespaces the
  root to `dashboard__public` in both cases — the id is stable regardless of which
  remote provided it.
- **The `apiClient` is built from `config.api`** (`host/src/api-client.ts`), folded
  by namespace (`dashboard` → `apiClient.dashboard.*`), and injected into router
  context. Remote components read it via `useRouteContext({ strict: false })` —
  which works because `react` and `@tanstack/react-router` are shared singletons.
- **Tenant override = one config swap.** No host routing code, no plugin awareness.
  The host reads `config.ui`, loads the referenced tree, composes. The same code
  path serves base and tenant.
- **SSR/auth/param mounts** (the 5-mount registry, `ssr: false` exclusion,
  parameterized org mounts) are already proven in the web-grafting prototype;
  this prototype trims the registry to `public` + `authenticated` to stay focused
  on override + injection.
