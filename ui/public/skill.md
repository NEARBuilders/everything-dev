# City Nodes skill

Use this when you want an agent to run, edit, and publish the **City Nodes** app — a decentralized network of NEAR validator nodes organized by geography. City Nodes is an `everything.dev` app: it runs on the everything.dev runtime platform (Module Federation host + oRPC API + Better-Auth with NEAR SIWN) and is composed at runtime from `bos.config.json`.

There are two ways to work with this app:

1. **Talk to the app** — use the API via MCP or REST to read/write data without cloning anything.
2. **Clone and modify** — clone the repository, run locally, edit code, and publish.

## Mode 1: Talk to the app

### MCP endpoint

The API is exposed as an MCP (Model Context Protocol) server at:

```
POST /api/mcp
```

Transport: Streamable HTTP (stateless, no session ID required).

Connect your MCP client to `{origin}/api/mcp` and it will discover all available tools automatically. Tools are generated from the API's OpenAPI spec — each API operation becomes a tool with typed input parameters.

### Authentication

All API operations require authentication. Use an **API key**:

1. Sign in with your NEAR wallet at the website (Sign-In-With-NEAR / SIWN).
2. Navigate to **Settings → API Keys** at `/settings/api-keys`.
3. Create a new key. The full secret (`edk_...`) is shown once — copy it immediately.
4. Pass the key on every request:

```
x-api-key: edk_your_key_here
```

This header works for `/api/*` (REST), `/api/rpc/*` (oRPC RPC), and `/api/mcp` (MCP).

### REST / OpenAPI

- **API docs UI**: `GET /api` (Scalar reference)
- **OpenAPI spec**: `GET /api/spec.json`
- **oRPC RPC**: `POST /api/rpc/{procedure}` (typed JSON-RPC)
- **Plugin RPC**: `POST /api/rpc/{plugin}/{procedure}` (e.g. `/api/rpc/auth/getSession`)

### MCP discovery

```
GET /.well-known/mcp.json
```

Returns a JSON descriptor with the server name, endpoint URL, and auth scheme.

### Available operations

The API exposes tenants, nodes, validators, and generic things:

- **Tenants**: list, create, update, delete, suspend, reactivate, resolve
- **Tenant bindings**: list, create, verify custom domain, set primary, resolve by hostname
- **Nodes**: list, get, create, update, delete, list root nodes, list children, resolve by slug
- **Validators**: list, get, create, update, delete, set default, resolve by account ID, resolve staking validators
- **Things**: create, get, list, delete (generic typed store via template plugin)

Auth plugin operations (session, NEAR SIWN, relay, API keys, organizations) are available via `/api/rpc/auth/*`.

## Mode 2: Clone and modify

### TanStack Intent

- Registry entry: `https://tanstack.com/intent/registry/everything-dev`
- Load with TanStack Intent: `npx @tanstack/intent@latest load everything-dev`
- If the agent supports registry URLs directly, point it at the registry entry above.

### What this repo is

This repo is the **main City Nodes runtime** — it contains the full everything.dev platform (host, CLI, plugin framework in `packages/`) plus the City Nodes product surface (UI, API, plugins). It is not a generated child project.

- Work across `host/`, `api/`, `ui/`, `plugins/`, and `packages/` as needed.
- The host is kept generic. UI is meant to be combined and put together. API aggregates plugins and is a plugin itself.
- **Remotes are not hosted APIs** — they are code bundles loaded via Module Federation at runtime. Everything runs in this runtime process, not on a remote server.
- It is okay to update the runtime and runtime-owned code. This repository is the main runtime, actively being improved and simplified per `plans/beta-v2/`.
- A generated child repo created by `bos init` works primarily in `ui/src/` and `bos.config.json`, inheriting the upstream host, auth, and API.

### What this app is

- **City Nodes** is a product, not a platform. The product surface: visitors browse a directory of geographic nodes (countries, states, cities), drill into a node's subdomain, and stake NEAR to that node's validator pool.
- A **node** is a NEAR validator tied to a real place. Each node has its own subdomain (`chicago.citynode.app`), its own NEAR treasury account, and 0..N validator pools. Nodes form a geography tree (country → state → city); a node's **subtree** aggregates validators for staking.
- A **validator** is the staking target: `account_id`, `protocol` (today: NEAR), `role` (`official` or `community`), and `is_default`. A node with no validators inherits from its parent chain.
- The **platform tenant** (`v1.citynode.near`) serves `citynode.app` — the root directory. It has a tenant record but no node record; it is the deployment surface, not a place.
- `bos.config.json` is the canonical runtime manifest. The host loads UI, API, and auth at runtime from URLs in the config.

### Read AGENTS.md first

After cloning, read **`AGENTS.md`** at the repo root. It contains:

- The TanStack Intent skills block (loadable skills for everything-dev, every-plugin, better-near-auth)
- Operational guidance: dev workflow, architecture, code changes, plugin architecture, testing, security
- Links to Matt Pocock workflow skills in `.agents/skills/` (TDD, code review, bug diagnosis, planning)
- Regression test instructions

### Simplified route structure

Public routes (no auth):

- `/` — landing: "What are CityNodes?" hero + directory of root nodes + Apply button
- `/about` — renders the repo `README.md` (the CityNodes product explainer) via a README-fetching loader
- `/apply` — internal route that redirects externally to `https://citynode.app/apply`
- `/skill` — renders this `skill.md`
- `/skill.md`, `/llms.txt` — raw doc endpoints
- `/things`, `/things/$thingId`, `/things/new`, `/things/live` — generic typed table demo (durable store + SSE)
- `/$accountId` — NEAR account profile overview (public)

Authed routes (behind `_authenticated`):

- `/login` — NEAR wallet sign-in entry (SIWN)
- `/dashboard` — authenticated landing
- `/stake` — stake page: subtree validators with selector (official/community, `is_default` pre-selected)
- `/orgs` — Better-Auth organizations (node management orgs)
- `/settings/*` — user settings (profile, auth methods, security, API keys)
- `/admin/*` — admin surface: tenants, nodes, relayer, system (admin role only)

Keep `_layout` and `_authenticated` generic. Do not bake tenant-specific product concepts into the scaffold shell.

### Scaffold a new everything.dev app

Use `bos init` for new child apps.

```bash
bos init your-app.everything.dev \
  --extends dev.everything.near/everything.dev \
  --account your-account.near \
  --overrides ui \
  --no-interactive
```

If your installed `bos` version rejects `--no-interactive` or other expected init flags, use one of these fallbacks:

```bash
bunx everything-dev@latest init your-app.everything.dev
```

or run `bos init` interactively and answer the prompts.

### Run locally

```bash
cp .env.example .env
bun install
docker compose up -d --wait   # Start local Postgres
bos dev
```

Useful variants:

```bash
bos dev --api remote    # isolate UI work
bos dev --ui remote      # isolate API work
bos start --no-interactive   # production URLs
```

### Edit the UI

- main UI code lives in `ui/src/`
- routes live in `ui/src/routes/` (TanStack file-based router; `routeTree.gen.ts` regenerates automatically)
- reusable components live in `ui/src/components/` (`@/components` barrel) and `ui/src/components/ui/` (primitives like `data-table`, `button`, `select` — import these directly)
- runtime helpers live in `ui/src/app.ts` (`getAppName`, `getAccount`, `getActiveRuntime`, `getRuntimeConfig`, `useApiClient`, `useAuthClient`)
- use semantic Tailwind classes: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`. No hardcoded colors.

### Edit the API / plugins

- API contract: `api/src/contract.ts` (oRPC route definitions + Zod schemas)
- API router: `api/src/index.ts` (`createRouter`)
- Plugins live under `plugins/<name>/` with `contract.ts` + `index.ts` + rspack config
- UI calls plugins via namespaced clients: `apiClient.template.listThings(...)`, `apiClient.registry.listRegistryApps(...)`, etc.

### Publish

```bash
bos build               # build all packages (updates bos.config.json)
bos publish             # publish config to the FastKV registry
bos publish --deploy    # build/deploy all workspaces, then publish
bos sync                # sync from upstream
```

After `bos publish --deploy`, `bos.config.json` gets deployed URLs + integrity.

### Regression tests

The repo has a Go-based regression test suite under `tests/regression/`. These cover boot surface, auth flows, CORS, OpenAPI, security headers, tenant bindings, and plugin registry. Keep them solid.

```bash
cd tests/regression && go test ./http/ -v
```

### Good tasks for an agent

- add or edit a public route under `_public/`
- wire a new API endpoint into `contract.ts` + `index.ts` and call it from the UI via `useApiClient()`
- add a node/validator admin flow under `_admin/`
- publish a UI update without changing the shared host
- debug why a tenant UI override is not loading

## Public entry points

- `/`
- `/about`
- `/apply` (redirects to `https://citynode.app/apply`)
- `/skill`
- `/skill.md`
- `/llms.txt`
- `/.well-known/mcp.json`
- `/api` (OpenAPI docs)
- `/api/spec.json` (OpenAPI spec)
- `/api/mcp` (MCP server)

## Tone

Prefer product-first explanations for visitors (what a City Node is, why stake), and runtime-first explanations for builders (how the host, UI, and API compose from `bos.config.json`). Keep NEAR and Module Federation context intact.
