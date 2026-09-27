# Plan 009: One error taxonomy, one message unwrapper, one handler-options factory

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- host/src/services/errors.ts host/src/services/plugins.ts host/src/routes/api.ts host/src/utils/errors.ts packages/every-plugin/src/runtime/errors.ts packages/every-plugin/src/errors.ts packages/every-plugin/src/plugin.ts packages/every-plugin/src/build/rspack/dev-server-middleware.ts`
> If any in-scope file changed since this plan was written (plans 001/002/004 touch some of these — their edits are expected drift), compare "Current state" against live code; on a mismatch beyond that, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: done/002-effect-bridge-dedupe.md, plans/004-orpc-boundary-typing.md (adjacent code; land after both)
- **Category**: tech-debt
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

The repo carries **three overlapping error taxonomies** for the same failure class (remote/plugin load failure) and **five hand-rolled cause-unwrappers** that each implement slightly different `Cause.squash` semantics. `FederationError` (host SSR remote load) and `ModuleFederationError` (every-plugin remote load) are the same concept under different tags, so no `catchTag` or status map can treat them uniformly — the host's final error handler degrades everything to strings because the tags don't match. Separately, the oRPC error-logging interceptor + `errorStatusMap` options block is hand-copied **six times** (one copy already drifted — only the plugin.ts variant unwraps FiberFailure).

## Current state

**Taxonomies**:
- `host/src/services/errors.ts:3-25` — `FederationError`, `PluginError` (Data.TaggedError, custom `message` getters).
- `host/src/services/plugins.ts:49-62` — `PluginBootstrapError` (a third host tag for plugin bootstrap failures; `stage: "load" | "init" | "db-preflight" | "db-migration"`).
- `packages/every-plugin/src/runtime/errors.ts:5-17` — `PluginRuntimeError`, `ModuleFederationError`, `ValidationError`.

**Unwrappers** (five implementations):
- `host/src/services/plugins.ts:15-47` — `unwrapErrorMessage` (hand-walked `(current as any).cause/_tag` chain — excerpt in the repo at those lines).
- `host/src/services/plugins.ts:114-131` — `formatError`.
- `packages/every-plugin/src/runtime/errors.ts:25-44` — `extractErrorMessage`.
- `packages/every-plugin/src/effect-bridge.ts:4-15` — `flattenError` (the one plan 002 makes canonical for plugins).
- `host/src/utils/errors.ts:3-56` — `extractErrorDetails` (already imports `Cause.squash` — the closest to the target pattern; see its use at lines 21, 41).

**Interceptor duplication** — the same options block, six sites:
- `host/src/routes/api.ts:39-49` (`registerPublicRpcRouter`), `:181-189`, `:195-218` — `errorStatusMap: PLUGIN_ERROR_STATUS_MAP, plugins: [new BatchHandlerPlugin()], interceptors: [onError((error) => { const formatted = formatORPCError(error); if (formatted) console.error(formatted); throw error; })]` (three copies in one file).
- `packages/every-plugin/src/plugin.ts:178-188` — fourth variant, additionally unwraps FiberFailure via `extractFromFiberFailure`.
- `packages/every-plugin/src/build/rspack/dev-server-middleware.ts:151-158` and `:163-171` — fifth and sixth.

**Settled decisions this plan must honor** (do not relitigate):
- `PLUGIN_ERROR_STATUS_MAP` spreads `COMMON_ERROR_STATUS_MAP` with `TIMEOUT: 504`, `CONNECTION_ERROR: 502` overrides (`packages/every-plugin/src/errors.ts:139-145`) — settled, keep.
- `formatORPCError` no longer prints a status (`packages/every-plugin/src/runtime/errors.ts:~129`) — settled.
- Wire format of error responses — unchanged by this plan.

Conventions: host imports every-plugin symbols via `"every-plugin"` root/facades; conventional commits.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| every-plugin unit / integration / dist | `cd packages/every-plugin && bun run test:unit` / `bun run test:integration` / `bun run build` | 67+ / 27 / success |
| Host tests | `bun run --cwd host test` | 150 pass + 2 known deploy-gated |
| HTTP regression (test DBs up) | `bun run test:regression:http:dev` | all pass |

## Scope

**In scope**:
- `packages/every-plugin/src/errors.ts`, `src/runtime/errors.ts` (add `squashToMessage`, `createRpcHandlerOptions`; keep existing exports)
- `host/src/services/{errors.ts,plugins.ts}`, `host/src/routes/api.ts`, `host/src/utils/errors.ts`
- `packages/every-plugin/src/plugin.ts`, `src/build/rspack/dev-server-middleware.ts` (interceptor dedupe only)
- Tests under `packages/every-plugin/tests/unit/` and `host/tests/`

**Out of scope**:
- The `_tag` string values of every-plugin's `PluginRuntimeError`/`ModuleFederationError` (published, used in logs/tests across repos — they stay).
- `plugins/auth` Better-Auth error shapes.
- Any change to HTTP status codes or the JSON error envelope.

## Git workflow

- Branch: `improve/009-error-taxonomy`.
- Commit style: `refactor(every-plugin,host)!: shared squashToMessage + createRpcHandlerOptions`.
- Do NOT push unless instructed.

## Steps

### Step 1: `squashToMessage` in every-plugin

Add to `packages/every-plugin/src/runtime/errors.ts` (re-export from `src/errors.ts`):

```ts
export const squashToMessage = (error: unknown): string => { /* Cause.squash + flattenError chain */ }
```

Semantics: `Cause.squash` first (model after `host/src/utils/errors.ts:21,41` — the host's best existing implementation), then the cause-chain flattening from `flattenError` (`effect-bridge.ts:4-15`), then the `_tag`-aware JSON fallback from `unwrapErrorMessage` (`plugins.ts:31-44`) for tagged non-Error objects. Unit-test against: plain Error, Error with cause chain, Data.TaggedError (no message getter), FiberFailure-shaped object, non-object.

**Verify**: `cd packages/every-plugin && bun run test:unit` → new cases pass.

### Step 2: `createRpcHandlerOptions` factory

Add to `packages/every-plugin/src/errors.ts`:

```ts
export function createRpcHandlerOptions(opts?: { openapi?: boolean }) {
  return {
    errorStatusMap: PLUGIN_ERROR_STATUS_MAP,
    plugins: opts?.openapi ? [new OpenAPIReferenceHandlerPlugin(...)] : [new BatchHandlerPlugin()],
    interceptors: [onError((error) => { const formatted = formatORPCError(error); if (formatted) logger...; throw error; })],
  };
}
```

Shape it from the **plugin.ts variant** (`packages/every-plugin/src/plugin.ts:178-188`) — it is the most complete (FiberFailure unwrap included). Keep the factory's return type loose enough for both `RPCHandler` and `OpenAPIHandler` options (check both constructors' option types; if they diverge beyond one field, two factories `createRpcOptions()` / `createOpenApiOptions()` sharing a common interceptor const is acceptable — report which). Logging: the host sites currently use `console.error` while `host/src/routes/api.ts:20` imports a `logger` — route the shared interceptor through an injectable sink defaulting to `console.error` (do not change host log destinations silently; the host passes its logger).

**Verify**: `cd packages/every-plugin && bunx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 3: Adopt the factory at all six sites

Replace the inline options blocks in `host/src/routes/api.ts:39-49,181-189,195-218`, `packages/every-plugin/src/plugin.ts:178-188`, and `dev-server-middleware.ts:151-171` with `createRpcHandlerOptions(...)` (host passes its `logger`; the api.ts OpenAPI handler keeps its `OpenAPIReferenceHandlerPlugin({ spec })` — the spec callback is per-site and stays at the call site).

**Verify**: `grep -c "errorStatusMap: PLUGIN_ERROR_STATUS_MAP" host/src/routes/api.ts packages/every-plugin/src` → 0 (only the factory defines it); `bun run --cwd host test` → 150 pass + 2 known.

### Step 4: Collapse the host unwrappers onto `squashToMessage`

- `host/src/services/plugins.ts:15-47` (`unwrapErrorMessage`) and `:114-131` (`formatError`): replace their bodies with delegating calls to `squashToMessage` (import from `"every-plugin"`), preserving their exported names/signatures (used across host logging). Delete the `(current as any)` chain.
- `host/src/utils/errors.ts` (`extractErrorDetails`): where its logic duplicates `squashToMessage`, delegate; keep any host-specific detail extraction (status, headers) it additionally provides.
- `host/src/services/errors.ts` — `FederationError`/`PluginError` stay (SSR tests assert their tags — `host/tests/integration/ssr-federation-error.test.ts` checks `_tag === "FederationError"`); only their message getters may delegate to `squashToMessage`.

**Verify**: `bun run --cwd host test` → 150 pass + 2 known (SSR error tests are the direct guard); `grep -n "as any" host/src/services/plugins.ts` → reduced (the cause-chain casts gone).

### Step 5: Full gates

Rebuild every-plugin dist; `bun typecheck && bun lint`; HTTP regression (error-kind mapping cases are the wire-format guard).

**Verify**: all green per the commands table.

## Test plan

- New every-plugin unit tests: `squashToMessage` case matrix (Step 1); `createRpcHandlerOptions` smoke (constructs `RPCHandler` with the options; error thrown in a handler is logged once through the sink and still serialized with the right status via the map).
- Existing guards: every-plugin integration error-handling tests, host SSR error tests (tag assertions), HTTP regression `TestErrorKindMapping` + `TestInternalErrorDoesNotLeakDetails`.

## Done criteria

- [ ] `grep -rn "onError((error" host/src packages/every-plugin/src | wc -l` → 1 (the factory) 
- [ ] `grep -n "(current as any)" host/src/services/plugins.ts` → no matches
- [ ] `squashToMessage` unit tests pass; factory smoke test passes
- [ ] `bun typecheck`, `bun lint`, every-plugin (67+/27), host (150+2 known), and HTTP regression all pass
- [ ] Changeset added (every-plugin minor: new exports; host internal)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- Host SSR tests assert on message strings that `squashToMessage` produces differently — do not weaken the tests; align `squashToMessage` to the existing output or keep the host getter's local formatting and report.
- `RPCHandler` and `OpenAPIHandler` option types are incompatible enough that one factory can't serve both honestly (two factories is the accepted fallback — report it, don't force one).
- Any wire-format change shows up in the HTTP regression suite — revert that step and report.

## Maintenance notes

- Full taxonomy unification (host `FederationError` ≡ every-plugin `ModuleFederationError`) was deliberately scoped OUT — the host tags are load-bearing in SSR tests and logs; revisit only with a logging/tag consumer inventory in hand.
- Reviewer: confirm the shared interceptor still unwraps FiberFailure (the plugin.ts behavior, not the host's weaker copies).
- When plan 004's typed boundary lands, re-type the factory's options return against oRPC's published option types.
