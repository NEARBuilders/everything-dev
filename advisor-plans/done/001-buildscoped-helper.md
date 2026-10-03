# Plan 001: Ship a `buildScoped` helper and retire the copy-pasted layer incantation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- packages/every-plugin/src plugins api/src packages/everything-dev/src/plugin.ts AGENTS.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt / dx
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

Every plugin that needs a scoped service (db pool, repository, publisher) hand-writes the same 4-line Effect incantation:

```ts
const svc = yield* Layer.buildWithScope(SomeLive.pipe(Layer.provide(dep)), yield* Effect.scope)
  .pipe(Effect.map((context) => Context.get(context, SomeTag)));
```

It is copy-pasted at **7 sites** (`api/src/index.ts:59`, `plugins/_template/src/index.ts:79`, `plugins/apps/src/index.ts:35`, `plugins/auth/src/index.ts:36`, `plugins/proposals/src/index.ts:51`, `plugins/votes/src/index.ts:24`, `packages/everything-dev/src/plugin.ts:345`). The old framework helper that deduplicated this (`tools.buildService`) was removed in the Effect 4 migration and never replaced, so AGENTS.md now carries a full warning paragraph to keep authors from getting the scope semantics wrong. A ~10-line helper in every-plugin collapses all 7 sites, shrinks the AGENTS.md guidance to one line, and lets the shipped skill doc teach one name instead of an incantation.

## Current state

- `packages/every-plugin/src/effect-bridge.ts` — the shared Effect/oRPC bridge module (`runEffect`, `flattenError`), publicly re-exported from `packages/every-plugin/src/index.ts`.
- The exemplar call site (single-service shape), `plugins/_template/src/index.ts:79-82`:

```ts
const thingsService = yield* Layer.buildWithScope(
  ThingsService.Live.pipe(Layer.provide(DatabaseLive(config.secrets.TEMPLATE_DATABASE_URL))),
  yield* Effect.scope,
).pipe(Effect.map((context) => Context.get(context, ThingsService)));
```

- The multi-service shape, `api/src/index.ts:59-66` (one merged layer, three `Context.get` calls):

```ts
const services = yield* Layer.buildWithScope(
  Layer.mergeAll(TenantsLive, NodesLive, ValidatorsLive).pipe(Layer.provide(database)),
  yield* Effect.scope,
);
const tenantsService = Context.get(services, TenantsTag);
```

- `packages/every-plugin/src/plugin.ts:46-49` — the public `initialize` signature (an internal `PluginIdTag` leaks into R; this plan adds a self-documenting alias for it, full removal is a separate future plan):

```ts
initialize?: (
  config: PluginInitializeInput<V, S>,
  plugins: P,
) => Effect.Effect<TDeps, Error, Scope.Scope | PluginIdTag>;
```

- Conventions: exports go through `packages/every-plugin/src/index.ts`; Effect imports come from the `"effect"` package directly inside every-plugin src (the `"every-plugin/effect"` facade is for consumers). No code comments in implementation (AGENTS.md "Style Requirements"); JSDoc on public API is acceptable — see `src/effect-bridge.ts:17-21` for the house style.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all workspaces) | `bun typecheck` | exit 0, all ✓ |
| Lint | `bun lint` | exit 0 |
| every-plugin unit tests | `cd packages/every-plugin && bun run test:unit` | 67 pass |
| every-plugin build (dist) | `cd packages/every-plugin && bun run build` | "Build complete" |
| every-plugin integration | `cd packages/every-plugin && bun run test:integration` | 27 pass |
| _template tests | `cd plugins/_template && bun run test` | 22 pass |
| api tests | `cd api && bun run test tests/unit/` | 66 pass |
| Root typecheck regenerates gitignored `.gen.ts` type files | `bun typecheck` | — |

## Scope

**In scope** (the only files you should modify):
- `packages/every-plugin/src/effect-helpers.ts` (create)
- `packages/every-plugin/src/index.ts` (export the new helpers)
- `packages/every-plugin/src/plugin.ts` (the `PluginEnv` alias only)
- The 7 call sites listed in "Why this matters"
- `AGENTS.md` (the "Scoped resources" paragraph, line ~472)
- `packages/every-plugin/skills/plugin-development/SKILL.md` (the scoped-resources section, lines ~160-210)

**Out of scope** (do NOT touch):
- `plugins/*/src/db/layer.ts` — per-plugin database layers; consolidation is a separate future plan.
- Any behavioral change to scope lifecycles — this is a pure wrapper.
- `packages/everything-dev/src/cli/upgrade.ts` — the codemod emits the hand-written shape today; leave it (a separate plan handles the codemod). After this plan lands the codemod output still compiles, it is just not minimal.

## Git workflow

- Branch: `improve/001-buildscoped-helper` off the current `orpc-v2` HEAD.
- Commit style: conventional commits, e.g. `feat(every-plugin): buildScoped helper replaces hand-rolled layer incantation`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the helpers

Create `packages/every-plugin/src/effect-helpers.ts` with two exported functions:

```ts
import { Context, Effect, Layer, Scope } from "effect";

export const buildScopedContext = <A, E, R>(
  layer: Layer.Layer<A, E, R>,
): Effect.Effect<A, E, Scope.Scope | R> =>
  Effect.flatMap(Effect.scope, (scope) => Layer.buildWithScope(layer, scope));

export const buildScoped = <S, A, E, R>(
  tag: Context.Service<S, A>,
  layer: Layer.Layer<S, E, R>,
): Effect.Effect<A, E, Scope.Scope | R> =>
  buildScopedContext(layer).pipe(Effect.map((context) => Context.get(context, tag)));
```

Adjust the exact generics if `bunx tsc` in `packages/every-plugin` demands it — the contract that must hold: (a) it works when called as `yield* buildScoped(ThingsService, ThingsService.Live.pipe(...))` inside `Effect.gen`, (b) the R channel carries whatever the layer requires (e.g. `PluginIdTag`), (c) resources release when the plugin scope closes. Export both from `packages/every-plugin/src/index.ts`.

**Verify**: `cd packages/every-plugin && bunx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 2: Add a scope-lifecycle test

Model after `packages/every-plugin/tests/unit/scope-lifecycle.test.ts` (it already pins release-on-shutdown for the hand-written shape). Add a case that uses `buildScoped` with a layer whose `acquire`/release are tracked (spy or counter), asserts the service is usable, and asserts release ran after the scope closes.

**Verify**: `cd packages/every-plugin && bun run test:unit` → all pass including the new case (68+).

### Step 3: Adopt at the 7 call sites

Mechanical replacement at each site listed in "Why this matters":
- Single-service sites → `const xService = yield* buildScoped(XTagOrService, XLive.pipe(Layer.provide(dep)));`
  Note: at the plugin call sites the "tag" argument is the `Context.Service` class constant (e.g. `ThingsService`, `VoteService`) — the same symbol currently passed to `Context.get`.
- The api multi-service site → `const services = yield* buildScopedContext(Layer.mergeAll(...).pipe(Layer.provide(database)));` then keep the three `Context.get` lines unchanged.
- `packages/everything-dev/src/plugin.ts:345-359` — same treatment (it has two `Context.get` calls; use `buildScopedContext` there).

Imports come from `"every-plugin"` (root) at plugin call sites — `api/src/lib/context.ts` already demonstrates importing from `"every-plugin"`.

**Verify**: `bun typecheck` → exit 0 across all workspaces (this also regenerates `.gen.ts` files — expected).

### Step 4: `PluginEnv` alias

In `packages/every-plugin/src/plugin.ts`, add and use in the two `initialize` signatures (lines ~46-49 and ~90-93):

```ts
export type PluginEnv = Scope.Scope | PluginIdTag;
```

This is a pure rename of the R channel type — no behavior change. Export `PluginEnv` from `src/index.ts`.

**Verify**: `cd packages/every-plugin && bunx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 5: Update the two documents

- `AGENTS.md` "Scoped resources" paragraph (~line 472): replace the incantation prose with: build scoped services with `buildScoped(tag, layer)` (or `buildScopedContext(layer)` for multi-service layers) from `"every-plugin"` inside `initialize`; resources release when the plugin shuts down; keep the one-sentence warning that `Effect.provide(Tag, Layer.effect(...))` still must not be used for persistent dependencies (transient scope).
- `packages/every-plugin/skills/plugin-development/SKILL.md` scoped-resources section (~lines 160-210): it currently teaches the REMOVED `tools.buildService(tag, layer)` API. Rewrite to the two-argument `initialize: (config, plugins)` signature and `yield* buildScoped(Tag, Live.pipe(Layer.provide(dep)))`. Also fix `plugins/_template/src/index.ts:32` docblock ("via tools.buildService when needed") and line 34 (`CommonPluginErrors` → `PluginErrors`).

**Verify**: `grep -rn "tools.buildService" packages/every-plugin plugins/_template AGENTS.md` → no matches.

### Step 6: Full verification + rebuild dist

`cd packages/every-plugin && bun run build` (the host/plugins consume dist in MF contexts; a stale dist is a known crash class), then the full gates.

**Verify**: `bun typecheck && bun lint` → exit 0; `cd packages/every-plugin && bun run test:unit && bun run test:integration` → 68+ and 27 pass; `cd plugins/_template && bun run test` → 22 pass; `cd api && bun run test tests/unit/` → 66 pass.

## Test plan

- New unit test in `packages/every-plugin/tests/unit/scope-lifecycle.test.ts` (or a sibling file): acquire/release counting through `buildScoped`, plus a multi-service `buildScopedContext` case asserting two tags resolve from one context.
- Existing suites (67 unit / 27 integration / 22 _template / 66 api) must stay green — they exercise all 7 rewritten call sites end-to-end.

## Done criteria

- [ ] `bun typecheck` exits 0
- [ ] `bun lint` exits 0
- [ ] `grep -rn "Layer.buildWithScope" plugins api/src/index.ts packages/everything-dev/src/plugin.ts` returns no matches outside `packages/every-plugin/src/effect-helpers.ts` and its test
- [ ] `grep -rn "tools.buildService" packages/every-plugin plugins/_template AGENTS.md` returns no matches
- [ ] every-plugin unit + integration suites pass with the new scope-lifecycle cases
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- The excerpts above don't match the live code (drift).
- `buildScoped` cannot be typed without `any` after two honest attempts — report the exact TS error; do not ship an `any`-typed helper.
- Adopting at a call site requires changing anything beyond the incantation lines (e.g. the layer composition itself differs) — stop and report that site.
- `PluginIdTag` no longer exists or the initialize signature has changed shape.

## Maintenance notes

- The `bos upgrade` codemod (`packages/everything-dev/src/cli/upgrade.ts`) still emits the hand-written shape; plan 012 handles the codemod — a reviewer may want a follow-up to emit `buildScoped` instead.
- The `PluginEnv` alias is cosmetic; removing `PluginIdTag` from the public R entirely is the goal of the every-plugin/db spike ticket (`.scratch/framework-improvements/issues/01-every-plugin-db-auth-spike.md`).
- When `@effect/platform` ships an Effect 4 release, revisit whether `Layer.buildWithScope` semantics changed.
