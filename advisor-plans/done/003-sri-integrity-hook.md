# Plan 003: Restore the dead SRI integrity fetch hook

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- host/src/services/plugins.ts host/src/services/integrity-registry.ts packages/everything-dev/src/mf.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug / security
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

`bos.config.json` plugin entries can declare `integrity` (SRI hash) for their remote bundles. The host registers those hashes (`integrityRegistry.registerEntry(...)` in `host/src/services/plugins.ts:342`) and then tries to install a fetch hook that verifies remote-entry downloads against them. But the hook is installed by reading `(runtime as any).__mfInstance` — **a property that is never assigned anywhere in the repo** (verified: this is its only reference). The hook therefore never installs, and SRI verification of remote Module Federation bundles silently does not run. The `as any` double-cast is exactly what let this typecheck while reading a nonexistent field.

## Current state

- `host/src/services/plugins.ts:462-480` — the bootstrap block:

```ts
await registerAppSharedDeps(
  mergeSharedMaps(config.api.shared, config.auth?.shared, collectPluginSharedDeps(config)),
);

const runtime = createPluginRuntime({
  registry: Object.fromEntries(
    allEntries.map((entry) => [entry.runtimeId, { remote: entry.config.url }]),
  ),
  secrets: {},
});

const mfInstance = (runtime as any).__mfInstance as any | undefined;
if (mfInstance) {
  installIntegrityFetchHook(mfInstance, integrityRegistry);
}
```

- `createPluginRuntime` (`packages/every-plugin/src/runtime/index.ts:24-35`) returns a `PluginRuntime` wrapper; the real Module Federation instance is created inside `PluginServiceLive`/`module-federation.service.ts:59-62` via `createInstance`/`registerInstalls` from `@module-federation/runtime` and is **not** exposed on the wrapper.
- `host/src/services/plugins.ts:1-2` already imports `getInstance` from `@module-federation/runtime` (used elsewhere in the file) — that is the documented way to reach the shared global MF instance.
- `packages/everything-dev/src/mf.ts:46-48` — `installIntegrityFetchHook(instance, registry)` no-ops with a warn when the instance is falsy.
- `registerAppSharedDeps` (called just above) ensures the global MF instance exists, so `getInstance()` called after it returns the live instance.
- Ordering constraint: the fetch hook must be installed BEFORE any remote entry is fetched, i.e. before any `runtime.usePlugin(...)` call (which happens later, in `loadPluginEntryEffect` at ~line 333+).
- There is an existing re-install guard: `installIntegrityFetchHook` checks for `__everythingDevIntegrityHook` before monkey-patching fetch — check `packages/everything-dev/src/mf.ts` for the exact guard name before writing the test.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all workspaces) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Host tests | `bun run --cwd host test` | 150 pass; 2 known deploy-gated failures in `runtime-remote.test.ts` (they load production v1 remotes — NOT caused by this change; do not chase them) |
| everything-dev build (dist) | `cd packages/everything-dev && bun run build` | success (needed if `src/mf.ts` is touched — it is re-exported via dist) |

## Scope

**In scope**:
- `host/src/services/plugins.ts` (the `__mfInstance` block only)
- `host/tests/integration/` (new or extended test file)
- `packages/everything-dev/src/mf.ts` (only if the hook guard needs a test seam — see Step 3)

**Out of scope**:
- `packages/every-plugin/src/runtime/**` — do not add a `__mfInstance` field to the runtime wrapper; the fix goes through `getInstance()`.
- Any change to how integrity hashes are declared or resolved.
- The `runtime: any` typing of `loadPluginEntryEffect` — that is plan 004.

## Git workflow

- Branch: `improve/003-sri-integrity-hook`.
- Commit style: `fix(host): install integrity fetch hook via getInstance (was dead code)`.
- Do NOT push unless instructed.

## Steps

### Step 1: Replace the dead read with `getInstance()`

In `host/src/services/plugins.ts`, replace lines 474-477 with:

```ts
const mfInstance = getInstance();
if (mfInstance) {
  installIntegrityFetchHook(mfInstance, integrityRegistry);
}
```

`getInstance` is already imported at the top of the file — verify with `grep -n "getInstance" host/src/services/plugins.ts | head -3`. If the import is missing, add it to the existing `@module-federation/runtime` import. Keep the falsy guard (defensive, and `installIntegrityFetchHook` warns on falsy anyway).

**Verify**: `bunx tsc --noEmit -p host/tsconfig.json` → exit 0; `grep -rn "__mfInstance" host/src` → no matches.

### Step 2: Prove ordering safety

Confirm no `runtime.usePlugin(...)` call executes between `createPluginRuntime` and the hook installation. Read `host/src/services/plugins.ts` from line 462 to the first `usePlugin` call site; the bootstrap block must install the hook while still inside the `Effect.tryPromise` that builds the runtime, before entry loading begins. If any remote load happens earlier (e.g. inside `registerAppSharedDeps`), that is a STOP condition — hook installation must move above it.

**Verify**: reading confirms `installIntegrityFetchHook` runs before the first `loadPluginEntryEffect` call; no command needed, but note the line numbers in your report.

### Step 3: Add the regression test

Add a test to `host/tests/integration/` (model after the structure of `ssr-fallback.test.ts`: node:http asset server + beforeAll/afterAll). The test must:
1. Spin a local static server serving a small JS file as a fake remote entry.
2. Create an `IntegrityRegistry` (import from the same module `plugins.ts` uses — check `host/src/services/integrity-registry.ts` for the constructor), register the server URL with a **wrong** SRI hash.
3. Call `installIntegrityFetchHook(getInstance(), registry)` (or, if the hook is not directly exported from `everything-dev/src/mf.ts`, export it — it is the natural seam — and rebuild everything-dev dist).
4. `fetch()` the URL through the patched global and assert the request fails with the integrity error (check `packages/everything-dev/src/mf.ts` for the exact error shape it throws on mismatch).
5. Restore the original `globalThis.fetch` in an `afterAll` (the hook monkey-patches fetch; leaking the patch would poison other tests).

**Verify**: `bun run --cwd host test` → your new test passes; total 151 pass + the 2 known deploy-gated failures unchanged.

## Test plan

- One new integration test as specified in Step 3, covering the mismatch-fails case. (The happy-path "correct hash allows fetch" case is optional but cheap — include it if the fake-entry approach makes it trivial.)

## Done criteria

- [ ] `grep -rn "__mfInstance" host/ packages/` returns no matches
- [ ] `bunx tsc --noEmit -p host/tsconfig.json` exits 0
- [ ] New integrity-hook test passes; host suite otherwise unchanged (150 pass + 2 known deploy-gated)
- [ ] `bun typecheck && bun lint` exit 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- The excerpt at `plugins.ts:474-477` doesn't match (drift).
- `getInstance()` returns `undefined` at that point in the boot sequence even after `registerAppSharedDeps` — report; do not reorder bootstrap phases on your own initiative.
- The hook's fetch patch breaks unrelated host tests in a way an `afterAll` restore can't fix.
- You find remote loads happening before the hook could be installed (Step 2 failure).

## Maintenance notes

- Reviewer should scrutinize: (a) hook installed before any `usePlugin`, (b) the test actually restores `globalThis.fetch`, (c) no double-install (the `__everythingDevIntegrityHook` guard in `everything-dev/src/mf.ts` handles re-entry).
- If every-plugin ever exposes its MF instance on the runtime wrapper, `getInstance()` remains correct — it is the same global instance.
