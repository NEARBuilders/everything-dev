# everything.dev skill

Use this when you want an agent to run, edit, and publish the **everything.dev** app — the open runtime for apps on NEAR. everything.dev runs on the everything.dev runtime platform (Module Federation host + oRPC API + Better-Auth with NEAR SIWN) and is composed at runtime from the authored `bos.app.ts` config.

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
3. Create a new key. The full secret (`api_...`) is shown once — copy it immediately.
4. Pass the key on every request:

```
x-api-key: api_your_key_here
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

The API shell exposes health and error-surface helpers; the feature surface lives in plugins:

- **API shell**: `ping` (health), `errors` (regression error kinds)
- **Auth plugin** (`/api/rpc/auth/*`): session, NEAR SIWN, relay, gas keys, API keys, organizations, passkeys
- **Template plugin** (`/api/rpc/template/*`): generic typed things store (create, get, list, delete, SSE stream)
- **Registry plugin** (`/api/rpc/registry/*`): published runtime registry + app metadata
- **Proposals plugin** (`/api/rpc/proposals/*`): proposal lifecycle
- **Votes plugin** (`/api/rpc/votes/*`): voting feed
- **AI plugin** (`/api/rpc/ai/*`): OpenAI-compatible chat streaming

## Mode 2: Clone and modify

### TanStack Intent

- Registry entry: `https://tanstack.com/intent/registry/everything-dev`
- Load with TanStack Intent: `npx @tanstack/intent@latest load everything-dev`
- If the agent supports registry URLs directly, point it at the registry entry above.

### What this repo is

This repo is the **everything.dev base runtime** — the source of truth for the published framework packages (`every-plugin`, `better-near-auth`, `everything-dev`), the universal runtime image, and the everything.dev app itself (host, slim UI/API shells, plugins). It is not a generated child project.

- Work across `host/`, `api/`, `ui/`, `plugins/`, and `packages/` as needed.
- The host is kept generic. UI is meant to be combined and put together. The API is a slim plugin shell; feature routes live in plugins.
- **Remotes are not hosted APIs** — they are code bundles loaded via Module Federation at runtime. Everything runs in this runtime process, not on a remote server.
- It is okay to update the runtime and runtime-owned code. This repository is the main runtime, actively being improved and simplified.
- A generated child repo created by `bos init` works primarily in `ui/src/` and its authored config, inheriting the upstream host, auth, and API.

### Read AGENTS.md first

After cloning, read **`AGENTS.md`** at the repo root. It contains:

- The TanStack Intent skills block (loadable skills for everything-dev, every-plugin, better-near-auth)
- Operational guidance: dev workflow, architecture, code changes, plugin architecture, testing, security
- Links to Matt Pocock workflow skills in `.agents/skills/` (TDD, code review, bug diagnosis, planning)
- Regression test instructions

### Simplified route structure

Public routes (no auth):

- `/` — landing: what the runtime is, how it works, link to the repository
- `/about` — renders the repo `README.md` via a README-fetching loader
- `/skill` — renders this `skill.md`
- `/skill.md`, `/llms.txt` — raw doc endpoints

Authed routes (behind `_authenticated`):

- `/login` — NEAR wallet sign-in entry (SIWN)
- `/dashboard` — authenticated landing (next steps, identity)
- `/orgs` — Better-Auth organizations (members, teams, invitations, API keys)
- `/things`, `/things/$thingId`, `/things/new`, `/things/live` — generic typed table demo (durable store + SSE via the template plugin)
- `/settings/*` — user settings (profile, auth methods, security, API keys) — grafted from the auth plugin UI
- `/chat` — AI plugin chat (grafted from the AI plugin UI)
- `/admin/*` — admin surface: overview + system (admin role only)

Keep `_layout` and `_authenticated` generic. Do not bake app-specific product concepts into the scaffold shell.

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
- reusable components live in `ui/src/components/` (`@/components` barrel) and `ui/src/components/ui/` (primitives like `button`, `select` — import these directly)
- runtime helpers live in `ui/src/app.ts` (`getAppName`, `getAccount`, `getActiveRuntime`, `getRuntimeConfig`, `useApiClient`, `useAuthClient`)
- use semantic Tailwind classes: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`. No hardcoded colors.

### Edit the API / plugins

- API shell contract: `api/src/contract.ts` (oRPC route definitions + Zod schemas)
- API shell router: `api/src/index.ts` (`createPlugin`)
- Plugins live under `plugins/<name>/` with `contract.ts` + `index.ts` + rspack config
- UI calls plugins via namespaced clients: `apiClient.template.listThings(...)`, `apiClient.registry.listRegistryApps(...)`, etc.

### Publish

```bash
bos build               # build all workspaces (staleness-checked prerequisites first)
bos deploy              # full train: preflight → build → upload bundles → publish config → image → Railway
bos publish             # config-only: re-publish the resolved config to FastKV
bos sync                # sync from upstream
```

Published config is authored in `bos.app.ts`; the resolved `bos.config.json` under `.bos/` is generated and never committed.

### Regression tests

The repo has a Go-based regression test suite under `tests/regression/`. These cover boot surface, auth flows, CORS, OpenAPI, security headers, and plugin registry. Keep them solid.

```bash
cd tests/regression && go test ./http/ -v
```

### Good tasks for an agent

- add or edit a public route under `_public/`
- wire a new API endpoint into `contract.ts` + `index.ts` and call it from the UI via `useApiClient()`
- add a plugin under `plugins/` and register it in `bos.app.ts`
- publish a UI update without changing the shared host
- debug why a composed remote is not loading

## Public entry points

- `/`
- `/about`
- `/skill`
- `/skill.md`
- `/llms.txt`
- `/.well-known/mcp.json`
- `/.well-known/version` — deployed fingerprint + per-slot pins + last watch-tick outcome
- `/api` (OpenAPI docs)
- `/api/spec.json` (OpenAPI spec)
- `/api/mcp` (MCP server)
