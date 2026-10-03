# Plan 004: Remove the oRPC-boundary `as any` chain and thread real types end to end

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- packages/every-plugin/src/plugin.ts packages/every-plugin/src/orpc.ts packages/every-plugin/src/runtime/index.ts packages/every-plugin/src/runtime/services/plugin.service.ts host/src/services/plugins.ts host/src/routes/api.ts api/src/index.ts`
> If any in-scope file changed since this plan was written (note: plan 001
> touches `plugin.ts` and `api/src/index.ts` — its edits are expected drift,
> account for them), compare "Current state" against live code; on a
> mismatch beyond that, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: done/001-buildscoped-helper.md (same files; land 001 first)
- **Category**: tech-debt / type-safety
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

The framework's headline promise is inferred, end-to-end types from plugin contract to host handler. Today the single most load-bearing path — where a plugin's contract becomes a router — is fully untyped: four consecutive `as any` casts in `every-plugin/src/plugin.ts:188-192`, propagating to `runtime/index.ts` and then to **six** more `as any` casts in `host/src/routes/api.ts` and three in `host/src/services/mcp.ts`. On top of that, `PluginServiceShape.initializePlugin` discards its typed config as `config: any` (the fully typed version exists one layer down in the loader), and `api/src/index.ts:68-97` hand-maintains a 30-line inline type duplicating the template plugin's contract because the typed `withPlugins` surface was not trusted at point of use. On beta-pinned oRPC (`2.0.0-beta.35`), any decorator/router typing change surfaces as production Module Federation breakage instead of a compile error — and the dead `__mfInstance` bug (plan 003) is a direct example of what these casts hide.

## Current state

**Framework side** — `packages/every-plugin/src/plugin.ts:178-192` (inside the plugin factory; `builder` is an oRPC `Implementer`, `errorMiddleware` wraps errors):

```ts
onError((error) => { ... }) as any,
(base as any).use(errorMiddleware),
config.createRouter(deps, builder as any),
return router as ContractedRouter<TContract, any>,
```

- `packages/every-plugin/src/types.ts:103` — `PluginRouterType<T> = ContractedRouter<PluginContract<T>, any>`.
- `packages/every-plugin/src/runtime/services/plugin.service.ts:29-33` — `initializePlugin(pluginInstance, config: any, plugins?)`; the typed signature exists at `plugin-loader.service.ts:96-103` (`config: { variables: InferSchemaInput<...>; secrets: InferSchemaInput<...> }`).
- `packages/every-plugin/src/runtime/index.ts:178-221` — casts router/`createClient` to `any`/target types; `initializePlugin(pluginInstance, config: any, plugins?)` repeated at ~218.

**Host side** — `host/src/routes/api.ts`:
- `:33` `Map<string, RPCHandler<any>>`, `:39` `new RPCHandler(router as any, {...})`, `:181` second `RPCHandler(apiRouter as any, ...)`, `:195` `new OpenAPIHandler(apiRouter as any, ...)`, `:200` `generator.generate(apiRouter as any, ...)`, `:65` `RPCHandler<any> | OpenAPIHandler<any>`.
- `host/src/services/plugins.ts:83` — `HostPluginEntry.router: unknown` (the choke point forcing all host-side casts); `:334` `loadPluginEntryEffect(runtime: any, ...)`.

**Consumer side** — `api/src/index.ts:68-97` — the hand-written inline `templateFactory` type (30 lines duplicating every procedure I/O shape of `plugins/_template/src/contract.ts`), cast from `(plugins as Record<string, unknown>).template`.

**What exists to build on**:
- oRPC v2 exports `RouterContract`, `AnyContractRouter` (deprecated alias) and `RouterContractClient` from `@orpc/contract`, and `DecoratedMiddleware` from `@orpc/server` (5 type args).
- `api/src/lib/auth.ts:65-109` shows the repo's current `DecoratedMiddleware` usage pattern.
- `ui/src/lib/api-types.gen.ts` shows cross-workspace contract imports are an accepted pattern (`import type { ContractType as BaseApiContract } from "../../../api/src/contract.ts"`).
- Conventions: no comments in implementation; match neighboring file style; conventional commits.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| every-plugin unit / integration | `cd packages/every-plugin && bun run test:unit` / `bun run test:integration` | 67+ / 27 pass |
| every-plugin dist | `cd packages/every-plugin && bun run build` | success |
| Host tests | `bun run --cwd host test` | 150 pass + 2 known deploy-gated failures |
| api tests | `cd api && bun run test tests/unit/` | 66 pass |
| HTTP regression (needs docker test DBs up: `bun run test:db:up`) | `bun run test:regression:http:dev` | all pass |

## Scope

**In scope**:
- `packages/every-plugin/src/plugin.ts`, `src/orpc.ts`, `src/types.ts`, `src/runtime/index.ts`, `src/runtime/services/plugin.service.ts`
- `host/src/services/plugins.ts`, `host/src/routes/api.ts`, `host/src/services/mcp.ts`
- `api/src/index.ts` (the templateFactory block)
- New test(s) under `packages/every-plugin/tests/unit/` and/or `host/tests/`

**Out of scope**:
- `plugins/_template/src/**`, other plugins — their `createRouter` bodies already typecheck.
- `packages/everything-dev/src/build/rspack/dev-server-middleware.ts` `any`s (dev-server boundary, separate concern).
- `plugins/auth/src/handlers/**` `as any` clusters on third-party Better-Auth shapes (different root cause).
- Public response/wire shapes — nothing observable may change.

## Git workflow

- Branch: `improve/004-orpc-boundary-typing`.
- Commit style: `refactor(every-plugin,host)!: typed router boundary replaces as-any chain` (breaking only if exported types change shape — add a changeset if `PluginRouterType` or the `Plugin` interface change publicly: `bun run changeset`).
- Do NOT push unless instructed.

## Steps

Work one boundary at a time; the codebase must typecheck after each step.

### Step 1: Contain the framework-internal casts in one typed helper

In `packages/every-plugin/src/orpc.ts`, add a typed helper (name it `attachErrorMiddleware`) that applies the error `onError` interceptor + middleware to the builder using oRPC's published types (`Middleware`/`DecoratedMiddleware` from `@orpc/server`), and use it in `src/plugin.ts:178-192` in place of the inline `as any` chain. Goal: the ONLY casts left in `plugin.ts` are inside this one helper. If oRPC `2.0.0-beta.35` generics genuinely cannot express the `builder.use(...)` combination, keep a single documented cast inside the helper and remove the other three (`onError(...) as any`, `config.createRouter(deps, builder as any)`, the return cast) — the helper is then the containment boundary. Report which path you took.

**Verify**: `cd packages/every-plugin && bunx tsc --noEmit -p tsconfig.json` → exit 0; `grep -c "as any" src/plugin.ts` → 0 (or 1, only inside `src/orpc.ts`).

### Step 2: Type `HostPluginEntry.router` and delete the host-side casts

- `host/src/services/plugins.ts:83`: change `router: unknown` to oRPC's widest router type (try `AnyContractedRouter` from `@orpc/server`; if it does not accept what `createRouter` returns, define a local `type AnyPluginRouter = ContractedRouter<RouterContract, ...>` that does — the goal is a named type that `RPCHandler<T>` accepts without `as any`).
- Replace `router as any` / `apiRouter as any` in `host/src/routes/api.ts:39,181,195,200` and the `<any>` generics at `:33,65` with the typed values; same for `host/src/services/mcp.ts:46,62,126`.
- `host/src/services/plugins.ts:334`: `loadPluginEntryEffect(runtime: any, ...)` → type as `PluginRuntime<Record<string, PluginRegistryEntry>>` (exported from `packages/every-plugin/src/runtime/index.ts` — check its exact export name with `grep -n "export" packages/every-plugin/src/runtime/index.ts | head`).

**Verify**: `bunx tsc --noEmit -p host/tsconfig.json` → exit 0; `grep -c "as any" host/src/routes/api.ts host/src/services/mcp.ts` → 0 in both.

### Step 3: Thread the typed config through `initializePlugin`

- `packages/every-plugin/src/runtime/services/plugin.service.ts:29-33` and `src/runtime/index.ts:~218`: make `initializePlugin` generic over the plugin exactly as `plugin-loader.service.ts:96-103` already is (copy that signature), removing `config: any`.

**Verify**: `cd packages/every-plugin && bun run test:unit && bun run test:integration` → all pass; `bunx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 4: Delete api's hand-written template client type

In `api/src/index.ts`, replace the 30-line `templateFactory` cast block (lines ~68-98) with a typed import. Preferred shape (cross-workspace type imports are established — see `ui/src/lib/api-types.gen.ts`):

```ts
import type { RouterContractClient } from "@orpc/contract";
import type { ContractType as TemplateContract } from "../_template/src/contract";
```

(verify the exact relative path with `ls plugins/_template/src/contract.ts` and how `api/tsconfig.json` includes paths — if cross-workspace import is awkward in api's tsconfig, the alternative is registering the template plugin in `bos.config.json` so `bos types gen` emits `template: ClientFactory<...>` into `api/src/lib/plugins-types.gen.ts` and using `PluginsClient["template"]`; choose whichever typechecks cleanly and report the choice). Replace `plugins as Record<string, unknown>` with the typed `plugins` argument the `withPlugins` generics already provide.

**Verify**: `cd api && bun run test tests/unit/` → 66 pass; `bun typecheck` → exit 0.

### Step 5: Full verification

Rebuild every-plugin dist, run the full gates, and run the HTTP regression suite to prove wire behavior is unchanged (error statuses, RPC envelope).

**Verify**: `bun typecheck && bun lint` → exit 0; every-plugin 67+/27; host 150 + 2 known; api 66; `bun run test:regression:http:dev` → all pass.

## Test plan

- New unit test in `packages/every-plugin/tests/unit/` asserting the typed path end-to-end: define a tiny contract, run the plugin factory's `createRouter` through `attachErrorMiddleware`, and call a procedure through an `RPCLink`-backed client asserting input/output types compile without casts (a type-diagnostics style test — model after `packages/every-plugin/tests/unit/type-diagnostics.test.ts` if present, else after `tests/unit/plugin.test.ts`).
- HTTP regression suite is the behavioral guard: statuses and JSON error envelope must be identical.

## Done criteria

- [ ] `grep -n "as any" packages/every-plugin/src/plugin.ts` → no matches (or exactly one documented cast inside `src/orpc.ts`'s helper, reported)
- [ ] `grep -n "as any" host/src/routes/api.ts host/src/services/mcp.ts` → no matches
- [ ] `grep -n "config: any" packages/every-plugin/src/runtime/services/plugin.service.ts packages/every-plugin/src/runtime/index.ts` → no matches
- [ ] The 30-line inline type no longer exists in `api/src/index.ts`
- [ ] `bun typecheck`, `bun lint`, all listed suites, and `bun run test:regression:http:dev` pass (host: 150 + 2 known deploy-gated)
- [ ] Changeset added if exported types changed (`bun run changeset`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- Drift beyond plan 001's expected edits.
- oRPC `2.0.0-beta.35` typing cannot express a boundary after two honest attempts at the generics — stop with the exact TS errors rather than accumulating new casts elsewhere (casting inside ONE named helper per boundary is the accepted fallback, not per call site).
- Removing a cast changes runtime behavior (e.g. decorator invocation order) — revert that step and report; wire compatibility is non-negotiable.
- The api template-typing step requires changes to `bos.config.json` plugins registration that alter runtime plugin loading — do not register new runtime plugins; use the type-import path instead.

## Maintenance notes

- When oRPC v2 leaves beta, re-run Step 1: the containment helper is where beta-typing debt is parked — delete its casts first.
- Watch `packages/every-plugin/src/types.ts:103` (`PluginRouterType`) — if it changed shape, child repos' generated types regenerate on their next `bos types gen`.
- Reviewer should scrutinize the HTTP regression diff for any status-code or error-envelope change.
