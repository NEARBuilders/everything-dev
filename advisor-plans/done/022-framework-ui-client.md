# Plan 022: Publish typed client factories from `everything-dev/ui/client`

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions below. Update your status row in
> `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 00d162cb..HEAD -- ui/src/lib/api.ts
> ui/src/lib/auth.ts ui/src/app.ts packages/everything-dev/package.json
> host/src/services/plugins.ts`. Mismatches vs "Current state" excerpts →
> STOP. Prerequisite: plan 021 merged (the client-construction code must sit
> on the post-train tree).

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 021-land-open-train.md
- **Category**: architecture / dx
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

Every UI surface — monolith routes, the upcoming grafted plugin trees
(plans 024/025), and child repos with only a `ui/` directory — needs typed
API/auth clients. Today client construction lives in the ui monolith
(`ui/src/lib/api.ts`, `ui/src/lib/auth.ts`) and is reachable only via `@/app`;
`packages/everything-dev` exports nothing client-shaped, so a standalone ui
bundle cannot get a typed client at all, and child repos receive a
sync-owned *copy* scaffolded by `bos init` (a drift class). Moving the
factories upstream into `everything-dev/ui/client` makes clients a framework
capability: any bundle imports them, grafted trees inherit the host router
context where they read clients from, and the `{ api, auth, [name]: client }`
map becomes a typed one-liner.

## Current state

All excerpts verified at `00d162cb` (files unchanged by 021 except none of
these — 021 touches none of them).

- `ui/src/lib/api.ts` (client construction, browser singleton):
  ```ts
  // ui/src/lib/api.ts:59-90
  export function createApiClient(
    runtimeConfig: { hostUrl: string; rpcBase: string },
    headers?: Headers,
  ): ApiClient {
    if (!runtimeConfig.hostUrl) throw new Error("Missing runtime host URL");
    if (typeof window !== "undefined" && !headers && browserApiClient) {
      return browserApiClient;
    }
    const client: ApiClient = createORPCClient(
      createRpcLink({ hostUrl: runtimeConfig.hostUrl, rpcBase: runtimeConfig.rpcBase }, headers),
    );
    if (typeof window !== "undefined" && !headers) browserApiClient = client;
    return client;
  }
  export function useApiClient(): ApiClient {
    return useRouter().options.context.apiClient;
  }
  export function useOrpc() {
    const client = useApiClient();
    return createTanstackQueryUtils(client);
  }
  ```
  `ApiClient` is `ContractRouterClient<ApiContract>` where `ApiContract`
  comes from the generated `ui/src/lib/api-types.gen.ts` (`api.ts:13-16`).
  Read the whole file before editing — the `RPCLink` construction
  (`createRpcLink`, credentials `include`) at `api.ts:20-57` moves verbatim.
- `ui/src/lib/auth.ts` (types + hooks):
  ```ts
  // ui/src/lib/auth.ts:130-140
  export type AuthClient = ReturnType<typeof createAuthClient>;
  export type SessionData = AuthClient["$Infer"]["Session"];
  export function useAuthClient(): AuthClient {
    return useRouter().options.context.authClient;
  }
  export const sessionQueryKey = ["session"] as const;
  ```
  `createAuthClient` builds a Better Auth client with plugins
  `inferAdditionalFields<Auth>`, `siwnClient` (NEP-413 recipients from
  `runtimeConfig.auth.variables.siwn`, `auth.ts:66-99`), admin/anonymous/
  phone/passkey/organization/apiKey; `baseURL = hostUrl`. `Auth` type from
  generated `ui/src/lib/auth-types.gen.ts` (`auth.ts:24`). Read the whole
  file before moving it.
- `ui/src/app.ts` re-exports both and types the router context:
  ```ts
  // ui/src/app.ts:88-104,121-125
  export type { ApiClient } from "./lib/api";
  export { createApiClient, useApiClient, useOrpc } from "./lib/api";
  export type { AuthClient, Organization, Passkey, SessionData } from "./lib/auth";
  export { createAuthClient, sessionQueryKey, sessionQueryOptions, useAuthClient } from "./lib/auth";
  ...
  export interface RouterContext extends BaseRouterContextWithApi<ApiClient, SessionData> {
    apiClient: ApiClient;
    authClient: AuthClientType;
  }
  ```
  with `BaseRouterContextWithApi` imported from `everything-dev/ui/types`.
- `packages/everything-dev/package.json` exports include `./ui`, `./ui/types`,
  `./ui/runtime`, `./ui/head`, `./ui/metadata`, `./ui/router`, `./db` —
  **no client subpath** (verified lines 120-182). Exports use source paths in
  the `import`/`types` conditions (`"./src/ui/index.ts"`) plus a `dist` trio —
  follow the exact same four-condition shape and add a tsdown entry if the
  package's build requires it (check `packages/everything-dev/tsdown.config.ts`).
- Server-side namespacing precedent — `host/src/services/plugins.ts`:
  ```ts
  // host/src/services/plugins.ts:683-715 (createPluginsClient)
  const pluginClients: Record<string, unknown> = {};
  for (const [key, plugin] of Object.entries(result.plugins)) {
    if (key === "api") continue;
    pluginClients[key] = plugin.createClient(context);
  }
  if (result.authClient) pluginClients.auth = result.authClient(context);
  return new Proxy(apiClient, { get(target, key) { ... }, has(target, key) { ... } });
  ```
  This is the shape the client-side map mirrors.
- Per-plugin RPC route convention (AGENTS.md, committed): plugin RPC is
  `POST /api/rpc/{plugin}/{procedure}`; the flat API is
  `POST /api/rpc/{procedure}`. The client-side plugin client is therefore an
  `RPCLink` with `url = ${hostUrl}/api/rpc/${pluginKey}`.
- Grafted plugin trees ride the **host router's context** (verified during the
  grafting survey): route components under a grafted subtree resolve
  `useRouter().options.context` from the core router — hooks reading context
  work with zero extra wiring.
- oRPC capabilities in play (orpc.dev): per-service `RPCLink` clients
  (Contract Client Factory pattern — clients from individual procedure
  contracts, keeping bundles decoupled). `DynamicLink` is NOT needed: each
  service gets its own client at a fixed URL; DynamicLink only pays off when
  one call-site must route across links at runtime.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 8/8 workspaces pass |
| Lint | `bun lint` | exit 0 |
| Framework tests | `bun run --cwd packages/everything-dev test` | all pass |
| UI tests | `bun run --cwd ui test` | all pass |
| Build check | `bun run --cwd packages/everything-dev build` | exit 0 |

## Suggested executor toolkit

- Reference: https://orpc.dev/docs/client/client-side and
  https://orpc.dev/docs/contract/client-factory for the generic-client typing
  idioms used in step 2.

## Scope

**In scope**:
- `packages/everything-dev/src/ui/client.ts` (create)
- `packages/everything-dev/src/ui/client-auth.ts` (create)
- `packages/everything-dev/package.json` (exports + tsdown entry)
- `packages/everything-dev/tsdown.config.ts` (entry, if required by build)
- `packages/everything-dev/tests/ui/client.test.ts` (create)
- `ui/src/lib/api.ts`, `ui/src/lib/auth.ts` (become thin re-export wrappers)
- `ui/src/app.ts` (only if re-export paths need adjusting)

**Out of scope**:
- `ui/src/routes/**` — no route changes.
- `host/**` — server-side `createPluginsClient` unchanged.
- Generated files (`api-types.gen.ts`, `auth-types.gen.ts`) — generator
  behavior unchanged.
- No changes to `bos.config.json`.

## Git workflow

- Branch: `feat/ui-client-subpath`. Conventional commits:
  `feat(everything-dev): ui/client subpath with typed client factories`.

## Steps

### Step 1: Create the framework client module

`packages/everything-dev/src/ui/client.ts`:
- Move `createRpcLink` (verbatim from `ui/src/lib/api.ts:20-57`).
- Generalize `createApiClient` to be contract-generic:
  `createApiClient<T extends Router<any, any>>(contract: T, cfg: {hostUrl:
  string; rpcBase: string}, headers?: Headers): ContractRouterClient<T>`.
  Keep the browser singleton, memoized per contract identity (`WeakMap<T,
  Client>` on the browser), preserving the existing single-contract behavior
  when the ui monolith passes its generated `ApiContract`.
- Add `createPluginApiClient<T>(contract: T, pluginKey: string, cfg)` — same
  link with `url = \`${hostUrl}/api/rpc/${pluginKey}\``.
- Add `createServiceClients<C extends Record<string, Router<any, any>>>(
  cfg, contracts: C & { api?: Router<any, any> })` returning
  `{ api: ContractRouterClient<C["api"]>, [K in keyof C]:
  ContractRouterClient<C[K]> }`. No Proxy needed client-side — fixed URLs,
  one client per service (document why DynamicLink is deferred).
- Add typed context hooks: `useApiClient<T = any>(): ContractRouterClient<T>`,
  `useOrpc`, and `usePluginClients<C>()` returning the router context object —
  implemented as `useRouter().options.context` reads (verified: grafted trees
  resolve the host router's context).

`packages/everything-dev/src/ui/client-auth.ts`:
- Move `createAuthClient`, `AuthClient`, `SessionData`, `useAuthClient`,
  `sessionQueryKey`, `sessionQueryOptions` verbatim from
  `ui/src/lib/auth.ts`. The `Auth` type import (generated) becomes a generic
  parameter: `createAuthClient<TAuth = any>(...)` — the ui monolith binds its
  generated `Auth`; plugin bundles bind theirs. The `siwnClient` recipient
  logic (`auth.ts:66-99`) is runtime-config-driven and moves unchanged.

Add the exports map entries `"./ui/client"` and `"./ui/client-auth"` in
`packages/everything-dev/package.json`, copying the four-condition shape of
the neighboring `"./ui/router"` entry; add tsdown entries if
`bun run --cwd packages/everything-dev build` shows missing artifacts.

**Verify**: `bun run --cwd packages/everything-dev build` → exit 0;
`bun typecheck` → 0 errors.

### Step 2: Rewire the ui monolith to re-export

- `ui/src/lib/api.ts` becomes: type-alias `ApiClient =
  ContractRouterClient<ApiContract>` (generated contract stays local) +
  `export { createApiClient, useApiClient, useOrpc } from "everything-dev/ui/
  client"` + `export const apiClient = createApiClient(ApiContract, ...)`? —
  No: `createApiClient` is *called* in `hydrate.tsx`/`router.tsx` with the
  generated contract; keep those call sites, only the factory moves. The
  wrapper file re-exports the factory pre-bound:
  `export const createApiClient = (cfg, headers?) =>
  createApiClientGen(ApiContract, cfg, headers)`.
- Same pattern for `ui/src/lib/auth.ts` with its generated `Auth`.
- `ui/src/app.ts` re-exports unchanged in shape; `RouterContext` type now
  built from the framework types directly (may import from
  `everything-dev/ui/client` instead of `./lib/*` — either is acceptable,
  prefer the framework import).

**Verify**: `bun run --cwd ui test` → all pass (nothing behavioral changed);
`bun run --cwd ui build` → exit 0.

### Step 3: Tests

`packages/everything-dev/tests/ui/client.test.ts` (vitest; model after
existing tests in `packages/everything-dev/tests/`):
- `createServiceClients` returns clients whose underlying links target
  `/api/rpc` and `/api/rpc/<key>` respectively (inspect via fetch interception
  or link internals — assert URL construction, not network I/O).
- Browser singleton: two calls with the same contract return the same
  instance; different contracts differ.
- `usePluginClients` returns the router context object (mock router).

**Verify**: `bun run --cwd packages/everything-dev test` → all pass incl. new.

## Done criteria

- [ ] `bun typecheck` exits 0
- [ ] `bun lint` exits 0
- [ ] `bun run --cwd packages/everything-dev test` green incl. client tests
- [ ] `bun run --cwd ui test` green; `bun run --cwd ui build` exit 0
- [ ] `grep -n "createORPCClient" ui/src/lib/api.ts` → no matches (moved)
- [ ] `packages/everything-dev/package.json` exports contain `./ui/client`
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- `ui/src/lib/api.ts`/`auth.ts` no longer match the excerpts (drift).
- Genericizing `createApiClient` breaks inference in existing route loaders
  (excessively deep type errors) — report instead of loosening types.
- The exports map change breaks `bos types gen` or the `dist` build in a way
  not resolvable inside the plan's scope.

## Maintenance notes

- Plans 024/025 consume this subpath for grafted plugin trees; keep the
  factory signatures stable (add, don't change).
- If the platform later serves plugin RPC under a different URL scheme, only
  `createPluginApiClient`'s URL construction changes.
- Reviewers: check the singleton memoization keyed per contract (no
  cross-contract leakage) and that `auth-types.gen.ts` generation is
  untouched.
