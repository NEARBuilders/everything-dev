# ADR 0006: Client factories live in `everything-dev/ui/api` + `ui/auth` — phantom-typed, endpoint-keyed, non-generic auth

Date: 2026-09-18
Status: Accepted

## Context

Plan 022 (advisor-plans/done/022-framework-ui-client.md) proposed `packages/everything-dev/src/ui/client.ts` + `client-auth.ts` to host the typed client factories that were sync-owned copies in every monolith (`ui/src/lib/api.ts`, `ui/src/lib/auth.ts`). Three problems surfaced during planning/execution:

1. **Naming.** `client.ts`/`client-auth.ts` name the mechanism, not the domain, and fight both the package's existing flat, domain-named file style (`runtime.ts`, `head.ts`, `metadata.ts`, `router.ts`, `types.ts`) and the code inside the modules (`createApiClient`, `useApiClient`, `createAuthClient`, `useAuthClient`). `client.gen.ts` was rejected outright: `.gen.ts` is reserved for machine-generated files (`bos types gen` output).
2. **Contracts are type-only.** Generated contracts (`ui/src/lib/api-types.gen.ts`, remote-manifest types) are `import type`-only — there is no runtime contract value to pass. A factory shaped like `createApiClient(contract, cfg)` forces call sites to fabricate dummy values, and a WeakMap memo keyed "per contract" has nothing real to key on.
3. **Generic auth poisons inference.** `createAuthClient<TAuth>(...)` makes the entire `createBetterAuthClient` call site deferred-generic, so better-auth's return type collapses to the plugin-less base client (`ReactAuthClient<BetterAuthClientOptions>`) — every `.near`/`.organization`/`.passkey` accessor in the monolith stops typing. This is a fundamental TS limitation: a generic function cannot return per-instantiation inferred types from its body's plugin array.

## Decision

- **Client factories live in the framework package as flat domain-named files**, mirroring the monolith `lib/` names 1:1 so the framework file is recognizably "the upstream of the wrapper":
  - `packages/everything-dev/src/ui/api.ts` → export `./ui/api` (oRPC factories + hooks)
  - `packages/everything-dev/src/ui/auth.ts` → export `./ui/auth` (Better-Auth factory + session helpers)
  - Exports follow the neighboring four-condition shape (`development` source / `types` / `import` / `require` dist trio) plus tsdown entries.
  - Going-forward convention: framework UI modules are flat domain-named files; subdirectories (`ui/compose/`, `ui/mf-build/`) remain from earlier work but are not the template; `.gen.ts` stays reserved for generated output.
- **Factories are phantom-typed — contracts are type parameters, never values:**
  ```ts
  createApiClient<ApiContract>(config, headers?): ContractRouterClient<ApiContract>
  createPluginApiClient<RegistryContract>(pluginKey, config, headers?)
  createServiceClients<{ api: ApiContract; registry: RegistryContract }>(config, keys, headers?)
  ```
  Call sites name the contract type explicitly; there is no value to infer from. This is deliberate — it matches the reality that all client-facing contracts in this platform are generated types.
- **Browser singleton is memoized per resolved endpoint URL** (`origin + rpcBase`, plugin key appended for plugin services), replacing plan 022's "WeakMap keyed per contract identity". Isolation is preserved by construction: api targets `rpcBase`, plugin K targets `rpcBase/K` — distinct contracts always resolve distinct URLs, and two contracts sharing one URL would be a configuration error. Requests carrying headers (SSR, API-key calls) skip the memo, same as before.
- **`createAuthClient` is non-generic** and uses `inferAdditionalFields<any>()`. The auth plugin defines zero `additionalFields` (verified in `plugins/auth/src`), so this is lossless today, and it keeps full plugin inference (`.near`, `.organization`, `.passkey`, SIWN). If an app ever defines additionalFields, that app declares its own thin typed binding in its wrapper — the framework does not attempt per-app Auth genericity.
- **DynamicLink is deferred.** Each service gets its own client at a fixed URL; DynamicLink only pays off when one call site must route across links at runtime, which no current consumer has.

## The three auth surfaces

| Path | Role | Ownership |
|------|------|-----------|
| `ui/src/lib/auth.ts` | Thin binding surface for the monolith (re-exports framework factory/types, plus generated `Auth` types) | sync-owned (framework) |
| `api/src/lib/auth.ts` | Server middleware (`requireAuth`, `requireRole`, …) and request-context types — not a client | sync-owned (framework) |
| `packages/everything-dev/src/ui/auth.ts` | The framework client factory (SIWN recipient logic, session helpers, hooks) | framework package |

The `./ui/*` export namespace means "client-side framework code", which is what disambiguates `everything-dev/ui/auth` from the server-side middleware file.

## Deviations from plan 022

- `client.ts`/`client-auth.ts` → `ui/api.ts`/`ui/auth.ts` (naming, above).
- Contract-value parameters → phantom type parameters (context 2, above).
- Per-contract WeakMap singleton → per-endpoint memoization (above).
- `createAuthClient<TAuth>` → non-generic (context 3, above). Plan 022's STOP condition ("genericizing breaks inference — report instead of loosening types") was resolved by removing the genericity entirely, which is strictly stronger than binding it at the wrapper.
- `createServiceClients` takes an explicit `keys` list: with phantom types the key set is not runtime-visible, so callers enumerate the services they build; the return type covers exactly the passed keys (`Pick` over the passed key set), not the full declared map.

## Consequences

- The ui monolith wrappers are now one-line type instantiations (`export const createApiClient = createFrameworkApiClient<ApiContract>`) — no runtime drift surface beyond the re-export itself.
- Plugin bundles (plans 024/025) consume the same factories with their own generated contract types; factory signatures must stay stable (add, don't change).
- New client-side service = one more flat file under `src/ui/` + exports/tsdown entries; no naming debate.
- If the platform later serves plugin RPC under a different URL scheme, only `createPluginApiClient`'s URL construction changes.
