# host

Server host with authentication, Module Federation orchestration, and every-plugin runtime.

## Architecture

The host orchestrates both UI and API federation:

```
┌─────────────────────────────────────────────────────────┐
│                        host                             │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │                  server.ts                     │     │
│  │  Hono.js + oRPC handlers                       │     │
│  └────────────────────────────────────────────────┘     │
│           ↑                         ↑                   │
│           │      bos.config.json    │                   │
│           │    (single source)      │                   │
│  ┌────────┴────────┐       ┌────────┴────────┐          │
│  │ UI Federation   │       │ API Plugins     │          │
│  │ (remoteEntry)   │       │ (every-plugin)  │          │
│  └────────┬────────┘       └────────┬────────┘          │
│           ↓                         ↓                   │
│  ┌─────────────────┐       ┌─────────────────┐          │
│  │ React app       │       │ oRPC router     │          │
│  │ (SSR/CSR)       │       │ (merged)        │          │
│  └─────────────────┘       └─────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

Today the host boots from one base `RuntimeConfig` snapshot and keeps auth, API, and server-side plugin wiring fixed for the lifetime of the process.

On top of that fixed server core, the host now supports request-scoped tenant UI resolution:

- base config boots the host, auth, API, and plugin routers once
- subdomains resolve tenants by convention, for example `alice.citynode.app -> alice.near`
- tenant config must extend the base BOS runtime
- tenant requests may override UI-facing remotes and sidebar metadata without changing the server core

For full host/plugin/auth/api hot-swap, see `plans/` for design docs. That is still a larger future design than the fixed-core tenant mode implemented now.

## Development

```bash
bos dev                 # Start development (host mode auto-detected)
bos dev                 # Full local development
```

## Production

```bash
bos start --no-interactive   # All remotes, production URLs
```

For the temporary publish registry, use `bos publish` or `bos publish --deploy`.

## Configuration

**bos.config.json**:

```json
{
  "app": {
    "host": {
      "title": "App Title",
      "description": "Description of the application",
      "development": "local:host",
      "production": "https://example.com/bundles/<account>/<gateway>/host/",
      "secrets": [
        "CORS_ORIGIN",
        "CSP_STRICT"
      ]
    }
  }
}
```

**Environment Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `BOS_ACCOUNT` | The NEAR account that owns this app's published configuration on-chain — signs `bos publish` transactions and namespaces the FastKV registry | From `bos.config.json` |
| `BOS_GATEWAY` | The core domain where this app is served — combined with `BOS_ACCOUNT`, forms the registry lookup path `bos://<account>/<gateway>` | From `bos.config.json` |
| `UI_SOURCE` | `local` or `remote` | Based on NODE_ENV |
| `API_SOURCE` | `local` or `remote` | Based on NODE_ENV |
| `API_PROXY` | Proxy API requests to another host URL | - |
| `NETWORK_ID` | Tenant account suffix resolution: `mainnet` or `testnet` | `mainnet` |
| `AUTH_DATABASE_URL` | PostgreSQL URL for auth | `postgres://everythingdev:everythingdev@localhost:5433/auth_db` |
| `BETTER_AUTH_SECRET` | Secret used for session encryption and key derivation | - |
| `CORS_ORIGIN` | Comma-separated allowed origins | Host + UI URLs |

## Multi-Tenant Status

- Current: one process-wide base `RuntimeConfig`, fixed auth/API/plugin server core
- Current: tenant subdomains can resolve request-scoped UI remotes from FastKV-backed BOS config
- Current: tenant config must extend the base BOS runtime
- Current: tenant accounts derive relative to the active runtime account namespace
- Current: supported tenant overrides are `app.ui`, existing `plugins.<id>.ui`, and existing `plugins.<id>.sidebar`
- Current: tenant SSR is gated per-tenant by the `allowSsr` column on the tenant record; the host's BindingResolver reads these permissions from the API's `GET /tenants/bindings` endpoint (cached for 30s)
- Not yet implemented: tenant API/auth overrides in fixed-core mode
- Not yet implemented: dynamic new plugin IDs per tenant

## Tenant Mode

Set `BOS_ACCOUNT` and `BOS_GATEWAY` to fetch the published config from FastKV instead of using the local `bos.config.json`:

```bash
# BOS_ACCOUNT: the NEAR account that owns the published config on-chain
# BOS_GATEWAY: the core domain this app is served on
BOS_ACCOUNT=v1.citynode.near BOS_GATEWAY=citynode.app bos start --no-interactive
```

Example tenant behavior:

- `citynode.app` serves the base runtime
- `alice.citynode.app` resolves `bos://alice.citynode.near/citynode.app`
- `bob.citynode.app` resolves `bos://bob.citynode.near/citynode.app`
- nested labels compose too, such as `chicago.alice.citynode.app` -> `bos://chicago.alice.citynode.near/citynode.app`

Tenant config rules:

- must extend the base BOS runtime
- may only override the tenant `ui` when `allow_ui_overrides` is true on the tenant record
- plugin UI overrides require `allow_backend_overrides` on the tenant record
- in fixed-core mode, only UI-facing overrides are applied
- custom UI remotes must provide integrity
- custom plugin UI remotes must provide integrity
- a child runtime with its own `account` and `domain` becomes a new tenant root on that domain even when it extends another runtime

Tenant SSR rules:

- tenant SSR is allowed only when the tenant record has `allow_ssr` set
- tenants without `allow_ssr` fall back to client rendering

### Proxy Mode

Set `API_PROXY=true` or `API_PROXY=<url>` to proxy all `/api/*` requests to another host:

```bash
API_PROXY=https://production.example.com bos dev
```

## Tech Stack

- **Server**: Hono.js + @hono/node-server
- **API**: oRPC (RPC + OpenAPI)
- **Auth**: Better-Auth + better-near-auth (SIWN)
- **Database**: PostgreSQL (`pg`) + Drizzle ORM
- **Build**: Rsbuild + Module Federation
- **Plugins**: every-plugin runtime

## Scripts

- `bun dev` - Start dev server (port 3000)
- `bun build` - Build MF bundle for production
- `bun preview` - Run production server locally
- `bun test` - Run tests
- `bun typecheck` - Type check

## Remote Host Mode

The host can be deployed as a Module Federation remote:

```bash
# Build and deploy
bos build host
bos deploy host
```

## API Routes

| Route | Description |
|-------|-------------|
| `/health` | Health check |
| `/api/auth/*` | Authentication endpoints (Better-Auth) |
| `/api/rpc/*` | RPC endpoint (batching supported) |
| `/api/*` | REST API (OpenAPI spec at `/api`) |
