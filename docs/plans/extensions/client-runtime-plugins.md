# Client-Runtime Plugins

## Problem

All plugins today run server-side. The host loads them via
`@module-federation/node`, composes their routers in-process via
`pluginsClient`, and serves their endpoints. This means:

- Every plugin requires server infrastructure (host process, DB connections, secrets)
- Users cannot extend the app with custom logic without deploying server-side code
- The architecture cannot serve NEAR web4 use cases where the browser IS the compute node
- Plugins that don't need server resources (no secrets, no shared DB) still pay the server cost

## Goal

Allow plugins to execute in the user's browser, loaded from the same CDN URLs and
configured from the same `bos.config.json`, but running client-side with
browser-native storage and compute.

This enables:

1. **User-authored browser plugins** — extend the app without server infrastructure
2. **web4 / NEAR integration** — browser-as-compute-node, sites served from the user's browser
3. **Offline-first API** — client plugins serve local data when the server is unreachable
4. **WASM-based persistence** — git-wasm + OPFS replaces SQLite for client plugins

## Architecture

### Runtime field on plugin config

The `plugins` map in `bos.config.json` gains a `runtime` field:

```jsonc
{
  "plugins": {
    "registry": {
      "runtime": "server",
      "development": "local:plugins/registry",
      "production": "https://cdn.../remoteEntry.js",
      "variables": {},
      "secrets": ["REGISTRY_RELAY_ACCOUNT_ID", "REGISTRY_RELAY_PRIVATE_KEY"]
    },
    "projects": {
      "runtime": "client",
      "development": "local:plugins/projects",
      "production": "https://cdn.../remoteEntry.js",
      "storage": "git-opfs",
      "variables": {}
    },
    "opencode": {
      "runtime": "client",
      "development": "local:plugins/opencode",
      "production": "https://cdn.../remoteEntry.js",
      "variables": {}
    }
  }
}
```

| Field | Values | Default | Description |
|-------|--------|---------|-------------|
| `runtime` | `"server"` \| `"client"` | `"server"` | Where the plugin executes |
| `storage` | `"git-opfs"` \| `"memory"` \| `"indexeddb"` | `"memory"` | Browser storage driver for `runtime: "client"` |
| `secrets` | string[] | — | **Invalid** for `runtime: "client"` (validated by host) |
| `variables` | object | — | Public config, injected into UI runtime config for client plugins |

Omitting `runtime` defaults to `"server"` — fully backward compatible.

### Dual loading paths

The host reads `runtime` to decide the loading path:

```
                     bos.config.json
                          │
               ┌──────────┴──────────┐
               │                     │
        runtime: "server"      runtime: "client"
               │                     │
    ┌──────────▼──────────┐  ┌───────▼────────────────┐
    │  Host (server)       │  │  UI (browser)           │
    │  @module-federation/ │  │  import() from CDN URL  │
    │  node/runtimePlugin  │  │  BunInBrowser proxy     │
    │  createPluginRuntime │  │  every-plugin/browser   │
    │  pluginsClient map   │  │  wasm-git + OPFS        │
    └──────────┬──────────┘  └───────────┬──────────────┘
               │                         │
        Server-side routes        WebSocket reverse proxy
        /api/rpc/{plugin}         {clientId}.proxy.web4.near.page
```

**Server plugins** load as today — `@module-federation/node`, `createPluginRuntime`,
two-phase loading, `pluginsClient` composition in-process.

**Client plugins** load differently:
1. Host injects their CDN URLs into the UI's `window.__RUNTIME_CONFIG__`
2. Browser `import()`s the plugin's remote entry from the CDN
3. Plugin registers with `BunInBrowser`, which connects to the WebSocket reverse proxy
4. Plugin's `fetch(req)` handler becomes accessible at a proxy URL
5. Host discovers the proxy URL and adds it to its route table

### Browser plugin runtime

The `every-plugin` package gains a browser-compatible runtime that replaces the
Node.js-specific parts:

| Component | Server (`every-plugin/runtime`) | Browser (`every-plugin/runtime/browser`) |
|---|---|---|
| Module loading | `@module-federation/node/runtimePlugin` | `import()` from CDN URL |
| Plugin lifecycle | `ManagedRuntime` (Effect) | Same — `ManagedRuntime` is pure JS |
| Config resolution | `createRequire("node:module")` for version | Build-time `__EVERY_PLUGIN_VERSION__` via `DefinePlugin` |
| Storage | `@libsql/client` (native SQLite) | wasm-git + OPFS (pluggable via `storage` config) |
| Secrets | Server env vars | **Not available** — client plugins must not depend on secrets |
| Plugin composition | `pluginsClient` in-process | `pluginsClient` in-process (same pattern, browser process) |
| HTTP serving | Hono on Node.js HTTP server | `BunInBrowser.serverModule.fetch()` over WebSocket proxy |

### wasm-git + OPFS as storage backend

[wasm-git](https://github.com/petersalomonsen/wasm-git) compiles libgit2 to
WebAssembly with an OPFS (Origin Private File System) backend. It provides:

- Full Git repository running client-side in a Web Worker
- Persistent file storage via the browser's OPFS API
- Commit, branch, push, pull entirely in the browser
- Synchronous execution in a Web Worker (pthreads + WASMFS)

This replaces `@libsql/client` for client plugins that need persistence. The swap
is architecturally clean because:

1. **Drizzle ORM is driver-agnostic** — the `projects` plugin's schema uses
   `drizzle-orm/sqlite-core` (type definitions, not driver code). The service
   layer uses generic query builders (`db.select()`, `db.insert()`, etc.).
2. **Database access is behind an Effect `Context.Tag` + `Layer`** — providing
   a different `Layer` implementation swaps the entire storage backend.
3. **The swap point is two files** — `db/index.ts` (driver) and `db/layer.ts`
   (Effect Layer wiring).

```typescript
// plugins/projects/src/db/index.ts — browser variant

import { createGitOpfsClient } from "every-plugin/storage/git-opfs";
import { drizzle } from "drizzle-orm/sql-js";

const client = await createGitOpfsClient({
  repoPath: "/opfs/projects",
  remoteUrl: runtimeConfig.syncUrl, // optional: push/pull to server
});
export const db = drizzle(client);
```

The `storage` field in `bos.config.json` tells the browser runtime which driver
to inject. This lets you swap storage per-plugin without code changes:

| `storage` value | Backend | Persistence | Sync |
|---|---|---|---|
| `"memory"` | In-memory Map | No (lost on tab close) | No |
| `"indexeddb"` | IndexedDB via `drizzle-orm/sql-js` | Yes | No |
| `"git-opfs"` | wasm-git + OPFS | Yes | Push/pull to Git remote |

### bun-in-browser integration

[bun-in-browser](https://github.com/vgrichina/bun-in-browser) provides a
WebSocket reverse proxy that tunnels HTTP requests to a browser client. Each
browser client gets a unique URL (e.g. `abc123.browser-proxy.web4.near.page`).

The client plugin registers its `fetch` handler:

```typescript
import { BunInBrowser } from "bun-in-browser/client";

const bun = new BunInBrowser("wss://browser-proxy.web4.near.page");

bun.serverModule = {
  fetch(req: Request): Response | Promise<Response> {
    // Route to the plugin's oRPC router
    return honoApp.fetch(req);
  },
};

await bun.waitUntilReady();
// Plugin is now accessible at bun.clientUrl
```

The host discovers this URL and adds it to the route table:

```
External request → Host → /api/{plugin} → WebSocket proxy → Browser plugin
```

### Updated architecture diagram

```
┌──────────────────────────────────────────────────────────────┐
│  Host (Server)                                               │
│  - Loads runtime:"server" plugins via MF (as today)          │
│  - Injects runtime:"client" CDN URLs into UI runtime config  │
│  - Proxies routes to client plugins via WebSocket tunnel      │
│  - Relays shared writes (registry relay, auth, etc.)          │
│  - Auth stays server-side (Better-Auth)                       │
└──────────────────────────────────────────────────────────────┘
       ↓                              ↓                        ↓
┌──────────────┐  ┌──────────────────────────────────────────────────┐
│  UI (Browser)│  │  Client Plugins (Browser)                        │
│              │  │                                                  │
│              │  │  ┌────────────┐ ┌──────────┐ ┌───────────────┐  │
│              │  │  │ projects   │ │ opencode │ │ user-custom   │  │
│              │  │  │ git-opfs   │ │ memory   │ │ git-opfs      │  │
│              │  │  └─────┬──────┘ └────┬─────┘ └──────┬────────┘  │
│              │  │        │              │              │            │
│              │  │  ┌─────▼──────────────▼──────────────▼──────┐    │
│              │  │  │ every-plugin/browser runtime              │    │
│              │  │  │ ManagedRuntime + Effect + pluginsClient   │    │
│              │  │  └────────────────────┬─────────────────────┘    │
│              │  │                       │                          │
│              │  │           BunInBrowser.serverModule.fetch()     │
│              │  │                       │                          │
│              │  └───────────────────────┼──────────────────────────┘
│              │                          ↕ WebSocket
│              │              ┌──────────────────────────┐
│              │              │  Reverse Proxy            │
│              │              │  wss://browser-proxy      │
│              │              │  .web4.near.page          │
│              │              └────────────┬─────────────┘
│              │                           ↕ HTTP
│              │            External callers (web4, etc.)
└──────────────┘
```

## Plugin compatibility

### Current plugin inventory

| Plugin | Uses SQLite? | Uses Node APIs? | Needs secrets? | Browser compat? | Adaptation effort |
|---|---|---|---|---|---|
| `_template` | No | No | Optional (default provided) | **Yes** | None |
| `opencode` | No | No | Optional (`OPENCODE_API_KEY`) | **Yes** | Low — `AbortSignal.timeout()` polyfill |
| `registry` (reads) | No | `process.env` ×3 (fallbacks) | No (read-only) | **Yes** | Low — replace env fallbacks with config |
| `registry` (relay) | No | No | Yes (3 relay secrets) | **No** | High — requires wallet-based signing |
| `projects` | Yes (`@libsql/client`) | No | Yes (DB URL + auth token) | **With WASM storage** | Medium — swap Drizzle driver |
| `api` (orchestrator) | Listed but unused | `process.env` ×2 | Listed but DB unused | **Yes** (once plugins compat) | Low — remove env reads |
| `every-plugin` runtime | No | `node:module` ×1 | N/A | **Yes** (1 trivial fix) | Trivial — build-time version |

### Adaptation paths

**`every-plugin` runtime** — one fix in `runtime/mf-config.ts`:

```typescript
// Current (Node.js only):
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Fixed (build-time injection):
declare const __EVERY_PLUGIN_VERSION__: string | undefined;
const version = __EVERY_PLUGIN_VERSION__ ?? "0.0.0";
```

Simply always defining `__EVERY_PLUGIN_VERSION__` via rspack's `DefinePlugin`
eliminates the Node.js dependency.

**`projects` plugin** — swap at the Drizzle driver layer:

Only two files change:
- `db/index.ts` — swap `@libsql/client` for WASM storage driver
- `db/layer.ts` — provide a different Effect `Layer` implementation

The Drizzle schema (`drizzle-orm/sqlite-core`) and service queries (`db.select()`,
`db.insert()`, etc.) remain identical.

**`registry` plugin** — split by operation type:

- Read operations (`listRegistryApps`, `getRegistryApp`, `getRegistryStatus`,
  `prepareRegistryMetadataWrite`) → `runtime: "client"` — pure `fetch()` to
  FastKV HTTP API
- Relay operation (`relayRegistryMetadataWrite`) → `runtime: "server"` — needs
  server-side private keys for transaction signing

This split can be expressed as two plugin entries in config, or the same plugin
with a `runtime: "client"` that skips relay routes (falling back to the server
plugin for relay).

**`opencode` plugin** — minor browser compat:

Replace `AbortSignal.timeout()` with `AbortController` + `setTimeout`. Change
default host from `localhost:4096` to a configurable URL. Everything else is
standard `fetch()` and `ReadableStream`.

## Security

### Threat model

Client plugins run in the user's browser. The trust boundary is:

```
┌─────────────────────────────────────────────┐
│  Trusted (server)                           │
│  - Auth sessions                            │
│  - Secrets / private keys                   │
│  - Shared state writes                      │
│  - Database connections                     │
└─────────────────────────────────────────────┘
              ↕ validated API boundary
┌─────────────────────────────────────────────┐
│  Untrusted (browser)                        │
│  - Client plugin code                       │
│  - User-authored extensions                 │
│  - Browser storage (OPFS, IndexedDB)        │
└─────────────────────────────────────────────┘
```

### Risk analysis

| Risk | Severity | Mitigation |
|------|----------|------------|
| Malicious plugin code in browser | Low | Browser sandbox applies; no server resource access; user runs own code |
| WebSocket proxy MITM | Medium | `wss://` enforced; certificate pinning; self-host option |
| Plugin reads auth tokens | Medium | Client plugins never receive auth sessions; auth stays server-side |
| Cross-user proxy access | Low | Each `BunInBrowser` client has unique `clientId`; no cross-client routing |
| Data exfiltration via git push | Medium | Validate remote URLs against whitelist; only push to configured repos |
| Client plugin crashes | Low | Only affects that user's session; other users unaffected |
| OPFS storage quota exhaustion | Low | Browser enforces quotas; graceful degradation |
| Config declares secrets for client plugin | — | **Rejected at validation** — host rejects `secrets` on `runtime: "client"` |

### Design principles

1. **Client plugins are read-only or user-scoped** — they read from public APIs
   and write only to local storage. Writes to shared server state go through
   server-side routes.
2. **Auth stays server-side** — Better-Auth sessions, NEAR wallet signing, and
   admin operations never run in client plugins.
3. **No secrets in the browser** — the `secrets` field is invalid for
   `runtime: "client"`. The host validates this at startup.
4. **SRI verification** — client plugin remote entries are loaded from CDN URLs
   with Subresource Integrity checks, same as server plugins today.
5. **Same-origin isolation** — client plugins share the browser's origin but
   run in separate Web Workers for compute-heavy operations (wasm-git).

## Implementation phases

### Phase 1: Browser-compatible every-plugin runtime

**Goal:** Make the `every-plugin` package work in the browser.

| File | Change |
|------|--------|
| `packages/every-plugin/src/runtime/mf-config.ts` | Replace `createRequire("node:module")` with build-time `__EVERY_PLUGIN_VERSION__` |
| `packages/every-plugin/src/runtime/browser/index.ts` | New: browser-compatible `createPluginRuntime` that uses `import()` instead of `@module-federation/node` |
| `packages/every-plugin/rspack.config.ts` | Add `DefinePlugin({ __EVERY_PLUGIN_VERSION__ })` |

**Validation:** `_template` plugin loads and runs in a browser test environment.

### Phase 2: `runtime` config field and host routing

**Goal:** Host reads `runtime` from config and routes accordingly.

| File | Change |
|------|--------|
| `packages/everything-dev/src/config.ts` | Add `runtime` and `storage` fields to plugin config schema |
| `host/src/services/plugins.ts` | Skip `usePlugin()` for `runtime: "client"` entries; inject their URLs into client config |
| `host/src/program.ts` | Add client plugin URLs to `window.__RUNTIME_CONFIG__` |
| `host/src/services/router.ts` | Proxy `/api/{clientPlugin}` to WebSocket proxy URL |

**Validation:** Host starts with mixed server/client config; server plugins load
as before; client plugin URLs appear in the UI's runtime config.

### Phase 3: BunInBrowser integration

**Goal:** Browser plugins register and serve via WebSocket proxy.

| File | Change |
|------|--------|
| `ui/src/lib/client-plugin-runtime.ts` | New: loads client plugin remotes, registers with `BunInBrowser`, creates `pluginsClient` |
| `ui/src/providers/index.tsx` | Initialize client plugin runtime on app mount |
| `ui/src/lib/api.ts` | Extend `useApiClient` to include client plugin routes |

**Validation:** A client plugin's `fetch` handler is accessible via the proxy URL.

### Phase 4: wasm-git + OPFS storage driver

**Goal:** Client plugins with `storage: "git-opfs"` get persistent storage.

| File | Change |
|------|--------|
| `packages/every-plugin/src/storage/git-opfs.ts` | New: WASM storage driver that wraps wasm-git with a Drizzle-compatible interface |
| `packages/every-plugin/src/storage/memory.ts` | New: in-memory storage driver |
| `packages/every-plugin/src/storage/indexeddb.ts` | New: IndexedDB storage driver |
| `plugins/projects/src/db/index.ts` | Conditional import based on `storage` config |
| `plugins/projects/src/db/layer.ts` | Provide different `Layer` based on storage driver |

**Validation:** `projects` plugin runs in browser with `git-opfs` storage, data
persists across page reloads.

### Phase 5: Plugin adaptation

**Goal:** Adapt existing plugins for browser compatibility.

| Plugin | Changes |
|--------|---------|
| `opencode` | `AbortSignal.timeout()` → `AbortController` + `setTimeout`; configurable host URL |
| `registry` | Replace `process.env` fallbacks with explicit config; split read/relay |
| `api` | Replace `process.env.EMAIL_PROVIDER`/`SMS_PROVIDER` with plugin variables |
| `projects` | Drizzle driver swap (Phase 4 provides the driver) |

### Phase 6: web4 / NEAR integration

**Goal:** Client plugins serve as web4-compatible endpoints.

| File | Change |
|------|--------|
| `packages/everything-dev/src/web4.ts` | New: register browser proxy URL with NEAR FastKV smart contract |
| `ui/src/routes/_layout/settings.tsx` | UI for managing web4 endpoint registration |

**Validation:** A client plugin is accessible at `{clientId}.browser-proxy.web4.near.page`.

### Phase 7: Offline-first API

**Goal:** Client plugins serve data locally when the server is unreachable.

| File | Change |
|------|--------|
| `ui/src/lib/api.ts` | Fallback chain: try server → try client plugin → return error |
| `ui/src/lib/offline-detection.ts` | New: detect server availability, switch API routing |

**Validation:** App works offline with client-plugin-served data.

## What this enables

### Today

```
All plugins → Host server → loaded via @module-federation/node
User extensions → not possible without server deployment
Offline → not possible (server required)
web4 → not possible (no browser compute node)
```

### After Phase 1–4

```
Server plugins → Host server (unchanged)
Client plugins → User's browser → BunInBrowser proxy
User extensions → write a plugin, set runtime: "client"
Storage → wasm-git + OPFS (versioned, offline, portable)
```

### After Phase 5–7

```
web4 endpoints → browser proxy URL registered on NEAR
Offline-first → client plugins serve data when server unreachable
Git-native data → every save is a commit, full history, push/pull sync
Data portability → user's data is a Git repo, clone/fork/move at any time
P2P plugins → browser clients discover each other via NEAR registry
```

## Key dependencies

| Package | Purpose | Status |
|---------|---------|--------|
| [bun-in-browser](https://github.com/vgrichina/bun-in-browser) | WebSocket reverse proxy for browser HTTP serving | Published (npm), public proxy available |
| [wasm-git](https://github.com/petersalomonsen/wasm-git) | Git compiled to WASM with OPFS backend | Published (npm), 816 stars, actively maintained |
| [wasm-git-apps](https://github.com/petersalomonsen/wasm-git-apps) | Devcontainer templates for wasm-git OPFS apps | Reference architecture for git-as-storage pattern |
| `@libsql/client/web` | HTTP/WebSocket libsql client (alternative storage) | Official, production-ready |

## Open questions

1. **Proxy topology** — should the WebSocket proxy be the existing public
   `wss://browser-proxy.web4.near.page`, or should the host self-host a proxy?
   Self-hosting gives more control but adds server infrastructure.

2. **Plugin composition across runtime boundary** — can a server plugin call a
   client plugin's routes? Currently `pluginsClient` is in-process. Cross-boundary
   calls would go through HTTP (server → proxy → browser). This is slower but
   possible. Should we support this, or restrict composition to same-runtime only?

3. **Hot reload for client plugins** — during development, how do client plugins
   reload? The dev server already serves HMR for the UI. Client plugins loaded
   via `import()` could use the same HMR mechanism, or they could be rebuilt and
   re-`import()`ed on change.

4. **wasm-git binary size** — the OPFS variant requires SharedArrayBuffer headers
   (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
   require-corp`). Does the host already send these? If not, they may block
   certain cross-origin resource loads.

5. **Drizzle + wasm-git impedance** — Drizzle expects a SQL-like driver interface.
   wasm-git provides a filesystem. We need either: (a) a SQL-over-filesystem
   adapter (like wa-sqlite + OPFS), or (b) a Drizzle driver that maps queries to
   filesystem operations. Option (a) is more general; option (b) is simpler.
