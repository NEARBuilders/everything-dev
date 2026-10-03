# Plan 016: Shared Effect test helpers in `every-plugin/testing` + fix the flaky port strategy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- packages/every-plugin/src/testing packages/every-plugin/package.json api/tests/setup.ts plugins/_template/tests/setup.ts api/tests/unit plugins/_template/tests/unit host/tests/integration`
> If any in-scope file changed since this plan was written (plans 001/002/006 touch some every-plugin/_template files — their edits are expected drift), compare "Current state" against live code; on a mismatch beyond that, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: done/001-buildscoped-helper.md (the `buildScoped` helper the new `runWithLayer` builds on)
- **Category**: tests / dx
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

Effect-4 service tests re-paste ~30 lines of run/squash scaffolding per file, and each copy can drift the assertion semantics. Concretely: `runService`/`squashServiceError` helpers are copy-pasted verbatim in `api/tests/unit/{nodes,tenants,validators}-service.test.ts` and `plugins/_template/tests/unit/things-service.test.ts`; the `Effect.runPromiseExit` → `Exit.isSuccess` → `Cause.squash(... as InstanceType<typeof FederationError>)` sequence repeats 6 more times across `host/tests/integration/ssr-{federation-error,fallback}.test.ts`. Separately, the two RPC test-server harnesses drifted: `api/tests/setup.ts` binds port **0** (correct — OS-assigned) while `plugins/_template/tests/setup.ts:36` picks `3000 + Math.floor(Math.random() * 1000)` — a range overlapping the dev servers on 3001/3002/3003 and other parallel test stacks: a latent EADDRINUSE flake. every-plugin already ships a `./testing` export surface hosting none of this.

## Current state

- `plugins/_template/tests/setup.ts:30-92` — node:http + `RPCHandler` + `RPCLink` harness; **line 36**: port picked as `3000 + Math.floor(Math.random() * 1000)`. The RPCLink construction (post-oRPC-v2) is:

```ts
const link = new RPCLink({ origin: baseUrl, url: "/rpc", fetch: globalThis.fetch, headers: context });
```

- `api/tests/setup.ts:31-91` — the same harness binding port `0` (`:62-75`) — the correct exemplar.
- Copy-pasted `runService`/`squashServiceError`: `api/tests/unit/nodes-service.test.ts:42-74`, `tenants-service.test.ts:35-58`, `validators-service.test.ts:47-80`, `plugins/_template/tests/unit/things-service.test.ts:31-54`.
- The exit/squash assertion sequence in host tests: `ssr-federation-error.test.ts:69,86,103,145,193,211` and `ssr-fallback.test.ts:323` — e.g.:

```ts
const result = await Effect.runPromiseExit(effect);
expect(Exit.isFailure(result)).toBe(true);
if (Exit.isSuccess(result)) throw new Error("Expected Left");
const leftError = Cause.squash(result.cause) as InstanceType<typeof FederationError>;
```

- `packages/every-plugin/src/testing/index.ts` — the existing `./testing` export surface (subpath export declared in `packages/every-plugin/package.json`).
- Effect 4 facts: `Effect.either` is gone (the reason these rewrites exist); `Effect.runPromiseExit` + `Exit` + `Cause.squash` are the canonical test tools.
- Conventions: test files import framework symbols via the `"every-plugin"` facades; vitest everywhere.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| every-plugin unit / dist | `cd packages/every-plugin && bun run test:unit` / `bun run build` | 67+ / success |
| api tests | `cd api && bun run test tests/unit/` | 66 pass |
| _template tests | `cd plugins/_template && bun run test` | 22 pass |
| Host tests | `bun run --cwd host test` | 150 pass + 2 known deploy-gated |

## Scope

**In scope**:
- `packages/every-plugin/src/testing/index.ts` (+ a new helpers module it re-exports)
- `plugins/_template/tests/setup.ts` (port 0 + adopt shared server helper)
- `api/tests/setup.ts` (adopt shared server helper if it collapses cleanly)
- The four copy-pasted helper blocks in the listed test files
- `host/tests/integration/ssr-federation-error.test.ts`, `ssr-fallback.test.ts` (adopt `expectEffectFailure`)

**Out of scope**:
- `packages/every-plugin/src/runtime/**` (the helpers test it, they don't change it).
- Other plugins' test files without the copied helpers.
- The every-plugin fixture integration harness (`tests/fixtures`, `build:test`).

## Git workflow

- Branch: `improve/016-test-helpers`.
- Commit style: `test(every-plugin,api,host)!: shared effect test helpers + port 0`.
- Do NOT push unless instructed.

## Steps

### Step 1: Add the helpers to `every-plugin/testing`

Create `packages/every-plugin/src/testing/helpers.ts` (re-export from `src/testing/index.ts`):

```ts
export async function expectEffectFailure<A, E>(effect: Effect.Effect<A, E>): Promise<unknown> {
  const result = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(result)) throw new Error("Expected failure but effect succeeded");
  return Cause.squash(result.cause);
}

export async function runWithLayer<A, E, R>(layer: Layer.Layer<R, E>, fn: (service: R) => Promise<A>): Promise<A> {
  // buildScopedContext(layer) → run fn → scope releases after
}
```

`runWithLayer` builds on plan 001's `buildScopedContext` (or, if 001 hasn't landed, on `Layer.buildWithScope` directly — accept either, note which). Keep `expectEffectFailure`'s return as the squashed value; callers cast to their expected error class (as today).

**Verify**: `cd packages/every-plugin && bunx tsc --noEmit -p tsconfig.json` → exit 0; unit tests still pass.

### Step 2: Unit-test the helpers themselves

Two small cases in `packages/every-plugin/tests/unit/` (model after existing unit test style): `expectEffectFailure` on a failing effect returns the squashed error and THROWS on a succeeding one; `runWithLayer` runs fn with the built service and releases the layer afterward (acquire/release spy).

**Verify**: `cd packages/every-plugin && bun run test:unit` → new cases pass.

### Step 3: Fix the template port + adopt the shared server helper

In `plugins/_template/tests/setup.ts:36`, replace the random 3000-range port with port `0` (copy the binding pattern from `api/tests/setup.ts:62-75`). If the two setup files differ only trivially beyond the port, extract the shared `startPluginTestServer()` into `every-plugin/testing` and adopt it in BOTH setups; if they differ more (context stubs, plugin bootstrap), fix ONLY the port and leave the harnesses separate — report which you did.

**Verify**: `cd plugins/_template && bun run test` → 22 pass; `grep -n "3000 + " plugins/_template/tests/setup.ts` → no match.

### Step 4: Collapse the copied run/squash blocks

Replace the four copy-pasted `runService`/`squashServiceError` blocks with imports from `every-plugin/testing` (local one-line wrappers naming the workspace's service type are fine if the copies had workspace-specific typing). In the two host SSR test files, replace the six+ exit/squash sequences with `expectEffectFailure(effect) as ...` (keep the `InstanceType<typeof FederationError>` casts at the call sites).

**Verify**: `cd api && bun run test tests/unit/` → 66 pass; `cd plugins/_template && bun run test` → 22 pass; `bun run --cwd host test` → 150 pass + 2 known.

### Step 5: Full gates + dist

`cd packages/every-plugin && bun run build` (the `./testing` subpath is consumed from dist in plugin contexts), then `bun typecheck && bun lint`.

**Verify**: all green per the commands table.

## Test plan

- Helper self-tests (Step 2).
- All adopting suites unchanged-green — the assertion semantics must be identical (same squashed values, same failure expectations).

## Done criteria

- [ ] `grep -rn "runService\b" api/tests plugins/_template/tests | wc -l` → 0 (or only thin one-line wrappers)
- [ ] `grep -n "Effect.runPromiseExit" host/tests/integration/ssr-federation-error.test.ts host/tests/integration/ssr-fallback.test.ts | wc -l` → 0 (all via `expectEffectFailure`)
- [ ] `grep -n "3000 + " plugins/_template/tests/setup.ts` → no match
- [ ] `bun typecheck`, `bun lint`, every-plugin (67+), api (66), _template (22), host (150+2 known) all pass
- [ ] Changeset added (every-plugin minor — new testing exports)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- `runWithLayer` can't express a workspace's setup (e.g. their tests need multiple services from one layer) — generalize to accept a callback receiving the built Context, or leave that workspace's local helper and report.
- The host SSR tests' `if (Exit.isSuccess(result)) throw` lines carry case-specific messages worth keeping verbatim — then leave those two sites local and report (don't force uniformity that loses diagnostic text).
- The two setup harnesses' shared extraction changes test behavior (context stubs differ materially) — port-0 only, report.

## Maintenance notes

- New plugins should reach for `every-plugin/testing` first; the `_template` scaffold's tests are the advertisement — when ticket 01 (every-plugin/db spike) rebuilds the template, its tests should use only these helpers.
- Reviewer: confirm `expectEffectFailure` failures print the squashed error in the vitest diff (returning it makes assertions like `expect(err._tag).toBe(...)` natural).
