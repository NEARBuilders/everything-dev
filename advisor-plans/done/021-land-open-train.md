# Plan 021: Land the open PR train (#119 → #120 → #121) with pre-merge hardening

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 00d162cb..HEAD` — this plan
> orchestrates *open PRs*, not files on the base branch. If any of the three
> branches named below have been merged or deleted, treat that step as done
> and move on. If the PR contents changed materially since 2026-09-18
> (re-diff them), treat changed hunks as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (unblocks 022–032)
- **Category**: migration / tech-debt
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

Three CI-green PRs carry the entire v2 foundation — build-tooling consolidation
(#119), bos auth + gasless publish (#120), UI route-grafting (#121) — and every
subsequent plan assumes they are merged. They are currently unmerged, stacked
on each other, and each contains specific defects (a credential-drop race, a
secret in a URL, a typed-code smell, duplicated helpers, and an in-place tree
mutation) that are cheap to fix now and expensive after consumers exist.

## Current state

- **PR #119** (`build-tooling-consolidation` → `main`): composed rspack stack
  (`EveryPluginComposedBuild` + `createPluginBaseConfig` in
  `packages/every-plugin/src/build/rspack/compose.ts`), `every-plugin
  dev|types|build|deploy` CLI (`packages/every-plugin/src/cli.ts`),
  `ensureGeneratedRspackConfig` (`build/rspack/generated-config.ts`),
  `withPluginDeploy` (`packages/everything-dev/src/integrity.ts`). Deletes six
  per-workspace `rspack.config.js` files. CI green.
- **PR #120** (`bos-gasless-auth` → `main`) **contains all of #119's commits**
  (stacked branch, also based on `main`). Adds `bos login`/`logout`
  (`packages/everything-dev/src/auth-login.ts`, `auth-session.ts`,
  `delegate-signer.ts`, `ui/src/routes/_layout/cli.tsx`), `bos publish
  --wallet` (NEP-366 delegate + relay), `publish.auth` config gate.
- **PR #121** (`feat/ui-route-grafting` → `main`): compose library
  (`packages/everything-dev/src/ui/compose/*`), host compose/SSR
  (`host/src/services/{ui-compose,ssr-render,federation.server}.ts`), client
  graft hydration (`ui/src/hydrate.tsx`, `ui/src/router.tsx`, `ui/src/tree.ts`).
  **Conflicts with #119** in `packages/every-plugin/src/dev/serve.ts` and
  `packages/every-plugin/tests/integration/dev-serve.test.ts` (both branches
  modify the retry/watch wiring) and in `.changeset/`.

Defects verified in the PR diffs (fix before/with merge):

1. **Handoff race** — `auth-login.ts`: the loopback server resolves
   `captured?.resolve({...})` on callback, but `captured` is only assigned
   when `waitForHandoff()` runs. If the browser hits `/callback` first, the
   credential is silently dropped while the page still reports "Login
   captured" and the CLI times out.
2. **API key in loopback URL query** — `ui/src/routes/_layout/cli.tsx`
   (`mintMutation.onSuccess`): `window.location.href = toLoopback(port, { key:
   data.key, ... })` puts the full minted API key in a URL (browser history;
   any local process can race the loopback listener).
3. **Dummy signing strategy** — `packages/everything-dev/src/publish.ts`
   (`--wallet` branch): `strategy = { strategy: "near-kit", privateKey: "",
   source: "provided" }` exists only to satisfy a type. The branch already
   bypasses `resolveSigningStrategy`; the dummy should not exist.
4. **Duplicated bos-config walk** — #119 adds `findBosConfigPath` in
   `build/rspack/compose.ts` AND `findBosConfigPathSync` in
   `build/rspack/generated-config.ts`. Same loop, two homes.
5. **`bosConfigPath ?? "."`** — `generated-config.ts` stringifies
   `bosConfigPath ?? "."`, so when no `bos.config.json` is reachable the
   generated config *still* wraps `withPluginDeploy` (truthy `"."`) pointed at
   a nonexistent path — integrity reporting silently fails at deploy time.
6. **In-place graft mutation** — `packages/everything-dev/src/ui/compose/compose.ts`
   (`composeApp`): assigns `child.options = {...}` on the *cached* remote tree
   object. The plugin tree cache (`federation.server.ts` `pluginTreeCache`)
   then holds permanently mutated objects; recomposition under a different
   mount mapping cannot un-graft.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck (all) | `bun typecheck` | 8/8 workspaces pass |
| Lint | `bun lint` | exit 0 |
| Root tests | `bun run test` | all pass (never `bun test`) |
| Host tests | `bun run --cwd host test` | pass, 8 deploy-gated skips |
| MF compat | `bos mf check` | green vs deployed manifests (or deploy-gated, see step 4) |

## Scope

**In scope**: the three PR branches (`build-tooling-consolidation`,
`bos-gasless-auth`, `feat/ui-route-grafting`) and `main` merge operations.

**Out of scope**: any new feature; changes to plugin backends; the sandbox/
CDN work (plans 029/032); closing PR #58 (Cloudflare CDN — handled separately
as superseded, do not merge it here).

## Git workflow

- Conventional commits, observed style: `fix(cli): ...`, `refactor: ...`.
- Do NOT push or merge without operator instruction — prepare the fixes on the
  branches and report; the operator performs the actual merges.

## Steps

### Step 1: Fix #119's two defects on its branch

1. In `packages/every-plugin/src/build/rspack/generated-config.ts`, change the
   generated-config template argument from `bosConfigPath ?? "."` to
   `bosConfigPath` (JSON.stringify(null) → `null` → template's existing
   `bosConfigPath ? withPluginDeploy(...) : config` branch emits a plain
   config). Delete `findBosConfigPathSync` and re-export the single
   `findBosConfigPath` from `compose.ts`.

**Verify**: `bun run --cwd packages/every-plugin test:all` → all pass (the
generated-config unit tests exist from #119); `bun typecheck` → 0 errors.

### Step 2: Fix #120's three defects on its branch

1. **Race**: in `packages/everything-dev/src/auth-login.ts`, create the
   handoff deferred at server start inside `startLoginServer` (a single
   `Promise<LoginHandoff>` + its resolvers, module-local to the handle);
   `waitForHandoff()` returns that promise and applies the timeout; the
   callback path resolves the pre-existing deferred. Delete the
   assign-on-wait `captured` variable.
2. **Secret in URL**: in `ui/src/routes/_layout/cli.tsx`, replace
   `window.location.href = toLoopback(...)` with `fetch` POST to
   `http://127.0.0.1:${port}/callback` sending JSON `{ state, key, keyId,
   account }` (delegate mode: `{ state, account, added: 1 }`). In
   `packages/everything-dev/src/auth-login.ts`, parse the POST JSON body on
   the callback route (keep GET handler returning 405 once POST exists, keep
   the `state` check and the `window.close()` response for the page fetch
   `mode: "cors"` case — the loopback server must set
   `Access-Control-Allow-Origin: *` for the site origin POST). The key never
   appears in a URL again.
3. **Dummy strategy**: in `packages/everything-dev/src/publish.ts`, delete the
   `strategy = { strategy: "near-kit", privateKey: "", source: "provided" }`
   assignment; restructure so the `input.wallet` path never builds a
   `SigningStrategy` (hoist the shared "Submitting transaction..." logging;
   the wallet branch calls `submitRegistryWriteDelegated` directly).

**Verify**: `bun run --cwd packages/everything-dev test` → all pass (includes
`tests/unit/auth-session.test.ts` and `publish-auth-guard.test.ts` added by
#120; add a unit test for the deferred-registered-before-browser behavior:
call the callback route handler before `waitForHandoff`, assert the handoff
resolves). `bun typecheck` → 0 errors.

### Step 3: Rebase #121 onto post-#119/#120 main

Conflicts expected in `packages/every-plugin/src/dev/serve.ts`,
`packages/every-plugin/tests/integration/dev-serve.test.ts`, `.changeset/*`.
Resolution rule: **keep both changes** — #119's
`ensureGeneratedRspackConfig(cwd)` watcher wiring AND #121's
`classifyPluginFailure` retry/backoff block are complementary; the test file
keeps both suites.

### Step 4: Fix #121's graft-mutation defect

In `packages/everything-dev/src/ui/compose/compose.ts` (`composeApp`): before
mutating a plugin subtree root, copy it — `const grafted = { ...(child as
MutableRoute), options: { ...rootOptions, id: namespacedId, getParentRoute: ()
=> coreRoute } }` — and use `grafted` in `subtreesByMount`/`grafts`/`target.
children`. The cached remote tree object is never mutated. Note: the *core*
tree's `children` append remains an in-place mutation of the compose-cache's
core tree — acceptable while the core tree is per-digest cached; the full
resolution arrives with plan 026 (in-process shell).

**Verify**: `bun run --cwd packages/everything-dev test` → all pass (compose
tests from #121); add one: compose twice with different `MOUNT_ALIASES`-visible
inputs and assert the second compose's plugin-tree input object still has its
original `options.id`. `bun run --cwd host test` → pass (deploy-gated skips OK).

### Step 5: Merge train (operator)

Order: **#119 → #120 → #121** (each rebase-merge; #120's diff shrinks after
#119 lands). After #121 merges, run the full gate.

**Verify**: `bun typecheck` 8/8 · `bun lint` · `bun run test` · `bos mf check`
— `bos mf check` may be deploy-gated until remotes redeploy on MF 2.9.0
(per PR #109's post-merge notes); if so, record it and proceed only after the
remote redeploy train or with operator sign-off.

## Test plan

- New: deferred-handoff test (step 2), graft-idempotence test (step 4), plus
  one generated-config case for `bosConfigPath = null` (step 1).
- Existing: everything-dev, every-plugin, host, ui suites as cited per step.

## Done criteria

- [ ] All three PRs merged to `main` in the stated order; no open conflicts.
- [ ] `grep -n "captured" packages/everything-dev/src/auth-login.ts` returns no
      assign-on-wait pattern (deferred exists from server start).
- [ ] `grep -n "toLoopback" ui/src/routes/_layout/cli.tsx` shows no `key`/
      `pubKey` in any URL construction (POST body only).
- [ ] `grep -rn "findBosConfigPathSync" packages/every-plugin/src` → no matches.
- [ ] `grep -n 'privateKey: ""' packages/everything-dev/src/publish.ts` → no matches.
- [ ] `bun typecheck` && `bun lint` && `bun run test` green on `main`.
- [ ] `advisor-plans/README.md` status row updated.

## STOP conditions

- The PRs have diverged materially from the diffs described in "Current
  state" (re-diff mismatch).
- The loopback POST change conflicts with an existing Better Auth CSP/
  mixed-content constraint that cannot be met on `127.0.0.1`.
- `bos mf check` cannot be satisfied and the operator has not approved a
  deploy train.

## Maintenance notes

- Plan 022 depends on the client factories staying where
  `ui/src/lib/api.ts`/`auth.ts` are until it moves them upstream.
- The remaining core-tree mutation is a known limitation; plan 026 removes the
  cached-remote core tree entirely.
- Reviewers should scrutinize the loopback POST handoff (CORS origin, no key
  in URLs) and the rebase of #121's serve.ts.
