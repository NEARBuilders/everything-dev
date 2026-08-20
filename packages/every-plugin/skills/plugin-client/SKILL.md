---
name: plugin-client
description: Connect to and consume deployed everything.dev plugins from an external app, child project, or script. Use when creating API/auth clients, reading runtime config, authenticating with API keys or sessions, or calling plugin routes programmatically.
metadata:
  sources: "ui/src/lib/api.ts,ui/src/lib/auth.ts,ui/src/app.ts,everything-dev/src/ui/runtime.ts,everything-dev/src/types.ts,host/src/program.ts,host/src/services/auth.ts,api/src/lib/auth.ts"
---

# Plugin Client — Consuming everything.dev APIs

## Minimal Connection Config

Every everything.dev host exposes two surfaces:

| Surface | URL | Purpose |
|---------|-----|---------|
| RPC | `{hostUrl}/api/rpc` | Typed oRPC procedure calls (POST) |
| OpenAPI / REST | `{hostUrl}/api` | Scalar docs + OpenAPI spec + REST routes |

The host injects a `ClientRuntimeConfig` into `window.__RUNTIME_CONFIG__` via an inline script during SSR. The key fields for client connection:

```ts
{
  hostUrl: "https://dev.everything.dev",  // the host server origin
  apiBase: "/api",
  rpcBase: "/api/rpc",
  authAvailable: true,
  account: "dev.everything.near",
  networkId: "mainnet",
}
```

Read it with `getRuntimeConfig()` from `everything-dev/ui/runtime`:

```ts
import { getRuntimeConfig } from "everything-dev/ui/runtime";

const config = getRuntimeConfig();  // throws if window.__RUNTIME_CONFIG__ is missing
```

Or use the `@/app` helpers (in-repo UI only):

```ts
import { getAccount, getActiveRuntime, getAppName, getRepository } from "@/app";

const account = getAccount();                          // "dev.everything.near"
const runtime = getActiveRuntime();                    // { accountId, gatewayId, title, ... }
const appName = getAppName();                           // runtime title or account
```

All helpers accept an optional config argument for SSR — pass `runtimeConfig` from loader data instead of reading `window`.

## External / Standalone API Client

An external app, script, or child project can connect with just `@orpc/client` and `@orpc/client/fetch`:

```ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

const HOST = "https://dev.everything.dev";

const link = new RPCLink({
  url: `${HOST}/api/rpc`,
  fetch: globalThis.fetch,
  headers: {
    "x-api-key": process.env.EVERYTHING_DEV_API_KEY!,
  },
});

const client = createORPCClient(link);
```

### URL Structure

oRPC's RPC protocol encodes the procedure path in the URL segment after the RPC base:

| Call | HTTP Request |
|------|-------------|
| `client.ping()` | `POST {hostUrl}/api/rpc/ping` |
| `client.apps.listRegistryApps({ limit: 24 })` | `POST {hostUrl}/api/rpc/apps/listRegistryApps` |
| `client.auth.getSession()` | `POST {hostUrl}/api/rpc/auth/getSession` |

The host matches `/api/rpc/{pluginKey}/*` prefixes and dispatches to each plugin's `RPCHandler`. Base API procedures (not namespaced) go to the main API handler at `/api/rpc`.

### Plugin Namespacing

Plugins are namespaced by their `bos.config.json` key. If the config has:

```json
{
  "plugins": {
    "apps": { "production": "https://..." },
    "template": { "production": "https://..." }
  }
}
```

Then the client surface is:

```ts
client.ping();                      // base API
client.apps.listRegistryApps();     // "apps" plugin
client.template.someProcedure();    // "template" plugin
client.auth.getSession();           // auth plugin (mounted at /api/rpc/auth)
```

Without the generated `ApiContract` type, the client is untyped — but the runtime behavior is identical. Use OpenAPI codegen (see below) for typed clients in other languages.

### Auth for External Clients

Two credential mechanisms:

**API key** — pass `x-api-key` header on every request:

```ts
const link = new RPCLink({
  url: `${HOST}/api/rpc`,
  fetch: globalThis.fetch,
  headers: { "x-api-key": "edk_xxxxxxxxxxxxxxx" },
});
```

**Session cookies** — use `credentials: "include"` (browser only, requires CORS origin allowlist):

```ts
const link = new RPCLink({
  url: `${HOST}/api/rpc`,
  fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
});
```

The host's session middleware resolves auth on every `/api/*` request by calling Better-Auth's `getContext()`, which reads session cookies and the `x-api-key` header. The resulting context (user, apiKey, organization) is forwarded into every plugin's oRPC handler.

## In-Repo API Client

Within the everything.dev UI, use `createApiClient` from `@/app`:

```ts
import { createApiClient, useApiClient, useOrpc } from "@/app";

// In hydration (once):
const apiClient = createApiClient({
  hostUrl: runtimeConfig.hostUrl,
  rpcBase: runtimeConfig.rpcBase,
});

// In route components:
const apiClient = useApiClient();
const result = await apiClient.apps.listRegistryApps({ limit: 24 });

// With TanStack Query utils:
const orpc = useOrpc();
const { data } = orpc.apps.listRegistryApps.useQuery({ limit: 24 });
```

`createApiClient` caches a singleton in the browser (when no SSR headers are passed). SSR builds a fresh client per request with forwarded cookies. See the `ui-integration` skill for route-level patterns, loaders, and error handling.

## Auth Client (Session-Based)

The auth client uses Better-Auth with SIWN (NEAR wallet sign-in). Create it with `createAuthClient` from `@/app`:

```ts
import { createAuthClient, sessionQueryOptions, useAuthClient } from "@/app";

// In hydration:
const authClient = createAuthClient({ runtimeConfig, cspNonce });

// In route components:
const authClient = useAuthClient();
```

### SIWN Configuration

The auth client reads NEAR recipient config from `runtimeConfig.auth.variables.siwn`:

```ts
// runtimeConfig.auth.variables.siwn:
{
  recipient: "dev.everything.near",           // single network
  // OR:
  recipients: {
    mainnet: "dev.everything.near",
    testnet: "dev.testnet.near",
  },
}
```

The client resolves `mainnetRecipient` from `recipients.mainnet ?? recipient` and infers `networkId` from the runtime config or the recipient suffix.

### Sign-In Flows

```ts
// NEAR wallet (SIWN)
await authClient.signIn.siwn({ networkId: "mainnet" });

// Email/password
await authClient.signIn.email({ email, password });

// Passkey
await authClient.signIn.passkey();

// Sign out
await authClient.signOut();

// Organization switching
await authClient.organization.setActive({ organizationId: "org_123" });
```

### Session Query

```ts
import { sessionQueryOptions } from "@/app";

// In a route loader (SSR-safe with initialData):
const session = await queryClient.ensureQueryData(
  sessionQueryOptions(authClient, context.session),
);

// In a component:
const { data: session } = useQuery(sessionQueryOptions(authClient));
```

Session query key is `["session"]` with 1-min stale time and 10-min GC time.

### SSR Cookie Forwarding

On the server, cookies can't be read from `window`. Pass request headers:

```ts
const authClient = createAuthClient({
  runtimeConfig,
  headers: request.headers,    // forwards session cookies
  cspNonce,
});
```

Both API and auth clients use `credentials: "include"` unconditionally. The host's CORS allows any HTTPS origin in production (configurable via `CORS_ORIGIN`).

## API Key Auth

For programmatic access (scripts, backend services, CI), use API keys instead of sessions.

### Creating API Keys

API keys are created via the Better-Auth `apiKeyClient()` plugin (exposed as `authClient.apiKey.*`):

```ts
const authClient = useAuthClient();

// Create a key (secret returned once!)
const { data, error } = await authClient.apiKey.create({
  name: "my-bot-key",
  configId: "org-keys",           // optional: scope to a key config
  organizationId: "org_123",      // optional: scope to an org
  expiresIn: 60 * 60 * 24 * 30,   // optional: 30 days (seconds)
});

if (data) {
  console.log(data.apiKey.key);   // "edk_xxxxxxxxx" — save this now
}
```

The full key secret is only returned at creation time. Store it immediately.

### Using API Keys

Pass the key in the `x-api-key` header:

```ts
const link = new RPCLink({
  url: `${HOST}/api/rpc`,
  fetch: globalThis.fetch,
  headers: { "x-api-key": "edk_xxxxxxxxxxxxxxx" },
});
```

Or with plain fetch to REST endpoints:

```ts
const res = await fetch(`${HOST}/api/v1/registry/apps`, {
  headers: { "x-api-key": "edk_xxxxxxxxxxxxxxx" },
});
```

### Permission Scopes

Keys have a `permissions` map (`Record<string, string[]>` — resource to allowed actions). Routes protected by `requireApiKey(requiredPermissions)` check that the key's permissions cover all required resource/action pairs:

```ts
// Server-side (plugin route):
builder.deleteThing
  .use(requireApiKey({ things: ["delete"] }))
  .handler(async ({ context }) => {
    context.apiKey.permissions;  // { things: ["delete", "create"], ... }
  });
```

If the key lacks a required permission, the server returns `FORBIDDEN` with `{ requiredPermissions, keyPermissions }` in the error data.

### Dual-Mode Auth

`requireAuthOrApiKey` accepts either a session or an API key — useful for routes that serve both interactive UI and programmatic clients:

```ts
builder.createThing
  .use(requireAuthOrApiKey)
  .handler(async ({ input, context }) => {
    if (context.apiKey) {
      // API key path
    } else if (context.user) {
      // Session path
    }
  });
```

See `references/api-keys.md` for the full API key route table, permission schema, and management examples.

## OpenAPI / REST

The host serves Scalar API reference docs and an OpenAPI spec:

| Endpoint | Content |
|----------|---------|
| `GET {hostUrl}/api` | Scalar HTML docs UI |
| `GET {hostUrl}/api` (Accept: application/json) | OpenAPI JSON spec |

Use the OpenAPI spec to generate typed clients in any language:

```bash
# Generate a TypeScript client
npx openapi-typescript-codegen --input https://dev.everything.dev/api --output ./generated-api

# Generate a Python client
openapi-generator-cli generate -i https://dev.everything.dev/api -g python -o ./api-client
```

REST routes follow the `oc.route({ method, path })` declarations in each plugin's contract. For example, `GET {hostUrl}/api/v1/registry/apps` maps to the `apps` plugin's `listRegistryApps` procedure.

### Plugin Manifests

Each deployed plugin exposes a manifest at `{pluginUrl}/plugin.manifest.json`:

```json
{
  "schemaVersion": 1,
  "kind": "every-plugin/manifest",
  "plugin": { "name": "apps", "version": "1.0.0" },
  "runtime": { "remoteEntry": "./remoteEntry.js" },
  "contract": {
    "kind": "orpc",
    "types": {
      "path": "./types/contract.d.ts",
      "exportName": "contract",
      "typeName": "ContractType",
      "sha256": "abc123..."
    }
  }
}
```

The manifest provides the contract type file path and SHA-256 checksum for verified type generation.

## Typed Clients via `bos types gen`

Child projects and the in-repo UI get typed API clients through generated contract bridge files.

### What It Generates

| File | Contents |
|------|----------|
| `ui/src/lib/api-types.gen.ts` | `ApiContract` — merged type of base API + all plugin contracts |
| `api/src/lib/plugins-types.gen.ts` | `PluginsClient` — factory types for in-process plugin composition |
| `*/src/lib/auth-types.gen.ts` | Auth plugin session/user/organization types |

### The Merged Contract

`api-types.gen.ts` intersects the base API contract with each plugin's contract as a namespaced key:

```ts
import type { ContractType as BaseApiContract } from "../../../api/src/contract.ts";
import type { ContractType as appsContract } from "../../../plugins/apps/src/contract.ts";

export type ApiContract = BaseApiContract & {
  auth: authContract;
  apps: appsContract;
  template: templateContract;
};
```

`ContractRouterClient<ApiContract>` turns this into a fully typed callable proxy — `apiClient.apps.listRegistryApps({ limit: 24 })` has complete input/output types.

### Regeneration Triggers

Generated files are gitignored and auto-regenerated on:
- `bun install` (via postinstall `bos types gen`)
- `bun typecheck`
- `bos dev` / `bos build`
- `bos plugin add` / `bos plugin remove`

After hand-editing `bos.config.json`, run `bos types gen` or restart `bos dev`.

### Type Resolution

- `local:plugins/<name>` → reads `src/contract.ts` directly from disk
- Remote URL → fetches `contract.d.ts` from the deployed plugin's manifest (with SHA-256 verification)
- Missing local path with no URL → skipped with a warning

## Child Project Config

A child project inherits the parent's host, API, auth, and plugins via the `extends` field in `bos.config.json`:

```json
{
  "extends": "bos://dev.everything.near/dev.everything.dev",
  "account": "myapp.near",
  "domain": "myapp.everything.dev"
}
```

This inherits:
- `app.host` — the parent's host server URL
- `app.ui` — the parent's UI CDN (overridable)
- `app.api` — the parent's API
- `app.auth` — the parent's auth plugin (via nested `extends` ref)
- `plugins` — all parent plugins (overridable per-key)

### Scaffolding with `bos init`

```bash
bos init myapp.everything.dev \
  --extends dev.everything.near/dev.everything.dev \
  --overrides ui,plugins \
  --plugins apps,template
```

This writes `bos.config.json` with `extends`, scaffolds the project, and generates types. The child's `postinstall` hook runs `bos types gen` automatically.

### What Can Be Overridden

Child configs can override `app.ui` (custom UI CDN) and `plugins.<key>` (custom plugin URLs). Which sections a tenant can customize is controlled per-tenant by the `allow_ui_overrides` and `allow_backend_overrides` flags on the tenant record, resolved by the host from the API's `GET /tenants/bindings` endpoint (cached for 30s).

See the `extends-config` skill for deep merge semantics, per-environment extends, and canonical field ordering.

## Common Mistakes

- **Wrong header for API keys** — use `x-api-key`, not `Authorization: Bearer`. The `Authorization` header is only listed in CORS allowed headers for third-party integrations, not for everything.dev auth.
- **Missing `credentials: "include"`** — session cookies won't be sent without it. Both `createApiClient` and `createAuthClient` set this automatically; external clients must set it manually.
- **Not saving the API key secret** — `authClient.apiKey.create()` returns the full key string (`edk_...`) only once. Subsequent calls to `list` or `update` return only the prefix and metadata.
- **Plugin key vs plugin name confusion** — the client namespace is the `bos.config.json` `plugins` key (e.g., `"apps"`), not the Module Federation `name` field. They often match but are not guaranteed to.
- **Forgetting to regenerate types** — after adding/removing plugins in `bos.config.json`, run `bos types gen` or restart `bos dev`. Stale `api-types.gen.ts` will have missing or wrong namespace keys.
