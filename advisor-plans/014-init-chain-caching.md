# Plan 014: Resolve the extends chain once per `bos init`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- packages/everything-dev/src/cli/init.ts packages/everything-dev/src/plugin.ts packages/everything-dev/tests`
> If any in-scope file changed since this plan was written (plans 006/011 touch other parts of these packages — init flow itself is expected unchanged), compare "Current state" against live code; on a mismatch beyond that, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: perf / dx
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

One `bos init` re-fetches the parent config and re-downloads **full GitHub tarballs** repeatedly: `resolveCatalogChainSource` (`init.ts:84-171`) walks the entire extends chain and, for every ancestor without a local `sourceDir`, calls `resolveSourceDir` → `fetchParentConfig` + `downloadTarball` (a full repo tarball, extracted to a temp dir) just to read its workspace catalog. `scaffoldMinimalProject` (`init.ts:1199-1204`) and `personalizeConfig` (`init.ts:853-859`) EACH call it, so the minimal path runs the whole chain twice; the interactive handler fetches the parent config again at `plugin.ts:1398` and `:1440` (with retries) plus a third `resolveSourceDir` at `:1464-1470`. On a 2-deep chain that's roughly 5+ FastKV fetches and 4+ full-repo tarball downloads — most of init's wall-clock, and a failure surface (GitHub rate limits; `init.ts:350-368` throws on non-404).

## Current state

- `packages/everything-dev/src/cli/init.ts:84-171` — `resolveCatalogChainSource(config)` walks the extends chain; per node without `sourceDir` calls `resolveSourceDir`.
- `init.ts:189-193` — `resolveSourceDir` does `fetchParentConfig` **plus** `downloadTarball`.
- `init.ts:1199-1204` — `scaffoldMinimalProject` calls `resolveCatalogChainSource`.
- `init.ts:853-859` — `personalizeConfig` calls it again.
- `packages/everything-dev/src/plugin.ts:1398,1440` — the init handler fetches parent config (with retry), duplicating the interactive flow's fetch at `src/cli/cli.ts:321`.
- `plugin.ts:1464-1470` — calls `resolveSourceDir` again (third fetch + tarball).
- `init.ts:350-368` — the fetch error handling (throws on non-404).
- Existing coverage: `packages/everything-dev/tests/integration/init.*.test.ts` — init is the best-covered CLI flow; these tests are the behavior guard.
- The scaffold decision point: `plugin.ts:1474` `isMinimalScaffold = sourceDir === ""`, where `resolveSourceDir` returns `""` only when no repository exists anywhere in the chain (`init.ts:205-209`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| everything-dev tests | `cd packages/everything-dev && bun run test` | 420+ pass (2 skipped) |
| everything-dev dist | `cd packages/everything-dev && bun run build` | success |

## Scope

**In scope**:
- `packages/everything-dev/src/cli/init.ts` (chain resolution, caching)
- `packages/everything-dev/src/plugin.ts` (the init handler's fetch sites, ~1390-1480)
- New/updated tests under `packages/everything-dev/tests/`

**Out of scope**:
- Changing WHAT init scaffolds (the minimal-vs-tarball default is ticket 02 — this plan only stops redundant resolution).
- FastKV client behavior, retry policy internals.
- `bos sync` / `bos upgrade` flows.

## Git workflow

- Branch: `improve/014-init-chain-caching`.
- Commit style: `perf(everything-dev): resolve extends chain once per init`.
- Do NOT push unless instructed.

## Steps

### Step 1: Define the chain context type

In `init.ts`, introduce:

```ts
export interface ResolvedChainContext {
  configs: Record<string, BosConfig>;     // keyed by bos:// ref, includes every ancestor
  catalogs: Record<string, Record<string, string>>; // workspace catalogs per ancestor
  sourceDir: string;                       // immediate parent's source dir, "" if none
}
```

and a `resolveExtendsChain(entryConfig, opts): Promise<ResolvedChainContext>` that walks the chain ONCE: fetch each ancestor config once (memoized by ref), read ancestor **catalogs from the already-fetched configs** (a config embeds its workspace catalog — verify by reading `fetchParentConfig`'s return shape; if catalogs genuinely require the tarball for some ancestors, download at most ONE tarball: the immediate parent's, and only when workspace files are actually needed).

**Verify**: `bunx tsc --noEmit` in the package → exit 0.

### Step 2: Thread the context through the phases

- `scaffoldMinimalProject` and `personalizeConfig` accept the `ResolvedChainContext` (or a narrow slice) instead of calling `resolveCatalogChainSource` internally.
- `plugin.ts` init handler (~1390-1480): resolve the chain once after the interactive flow confirms the parent, pass it down; delete the duplicate `fetchParentConfig` calls at `:1398`/`:1440` (reuse `cli.ts:321`'s fetch result via the chain context) and the duplicate `resolveSourceDir` at `:1464-1470`.
- Keep every externally observable behavior: same prompts, same scaffold output, same snapshot/personalization, same error messages on fetch failure (the `init.ts:350-368` semantics move into the single resolver).

**Verify**: `cd packages/everything-dev && bun run test` → init integration suites pass unchanged (they are the behavioral contract).

### Step 3: Count the fetches (test)

Add/extend a test asserting call counts: stub `fetchParentConfig` and `downloadTarball` (follow the existing init tests' stubbing pattern — read one to copy the technique) and run a 2-deep-chain init scenario asserting: `fetchParentConfig` called once per unique ancestor (not 2-3×), `downloadTarball` called at most once.

**Verify**: the count test passes; `bun run test` green.

### Step 4: Full gates

`bun typecheck && bun lint`; rebuild dist.

**Verify**: all green per the commands table.

## Test plan

- Call-count test (Step 3) — the regression guard for re-resolution.
- Existing init integration suites unchanged and green (behavioral contract).
- One error-path test if not already covered: ancestor fetch failure surfaces the same error as before (semantics moved, not changed).

## Done criteria

- [ ] `grep -c "resolveCatalogChainSource" packages/everything-dev/src` → defined once, called once per init
- [ ] `grep -c "fetchParentConfig" packages/everything-dev/src/plugin.ts` → zero (handler uses the chain context)
- [ ] Call-count test proves ≤1 tarball download and 1 fetch per unique ancestor on a 2-deep chain
- [ ] Init integration suites pass unchanged; `bun typecheck`, `bun lint` exit 0
- [ ] Changeset added (everything-dev patch — pure perf/DX, no behavior change)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- Ancestor catalogs are NOT embedded in the fetched config and genuinely require tarballs (verify in Step 1 before assuming) — then scope the caching to config fetches only and report the constraint.
- The init tests' stubbing approach can't observe `downloadTarball` call counts without invasive refactoring — a lighter assertion (e.g. temp-dir count) is acceptable; report what you used.
- Some observable behavior (prompt order, output files) shifts when the duplicate fetches are removed — the init tests should catch it; if they don't and you notice it manually, STOP and report rather than absorbing a behavior change into a perf plan.

## Maintenance notes

- Ticket 02 (minimal-scaffold default) builds directly on `ResolvedChainContext` — its "sparse fetch of only selected override workspaces" extends this structure.
- Reviewer: confirm no new global mutable cache (the context is per-invocation; a module-level memo would leak across `bos` invocations in tests).
