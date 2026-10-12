# 051 — Test audit: wire the unwired suites into CI (and fix the void they hide)

Written against commit `d1bc2e3c` (2026-10-11). Companion to plan 050 (removals) and 052 (aggressive options). **Executed 2026-10-12** — see the addendum at the end for what landed and the one BLOCKED suite.

## Execution addendum (2026-10-12)

- **Landed**: `plugins` + `ui-api` change-detection outputs in ci.yml; `plugin-tests` job expanded (every-plugin `test:all`, auth `pnpm --filter @everything-dev/auth-plugin test` — 350 tests green locally — votes, registry) with a member-list comment for future plugins; new `ui-api-tests` job (`pnpm --filter ui test` — 135 green, `pnpm --filter api test` — 23 green); `--passWithNoTests` removed from both the api and votes test scripts; `Bun.sleep` → `timers/promises.setTimeout` in `start-stack.mjs`.
- **BLOCKED — proposals excluded from the CI job**: the suite is red on main independent of this work — `getProposals` masks `createdBy` as `"[hidden]"` for every non-admin caller (`plugins/proposals/src/index.ts:245`) while `src/__tests__/proposals.test.ts:163` asserts the owner sees their own. 9/10 tests pass. Deciding owner-visibility intent is a product call; wire the suite once decided (the job carries a comment pointing here).
- **Step 4 resolved as option (b) with a repair rider**: the resolved/authored config never carries production URLs (pipeline state; `bos.app.ts:6`), so option (a) as written was impossible without published-config-fetch machinery. The `deploy.yml` smoke step is retired; its coverage accounting lives in the mf-check step, `tests/smoke/runtime-image.mjs` (`/health`, SSR HTML, spec.json, in-image mf check), and the CI browser `start:*` modes. The host helper was still repaired — `loadRawBosConfig` now reads `.bos/bos.resolved-config.json` (falling back to legacy `bos.config.json`) with honest skip reasons, so `pnpm --filter host test:integration:remote` stays a working local diagnostic instead of an ENOENT-driven mystery.

## The verified wiring matrix

`pnpm run test` (package.json:36) = `test:ui && test:api && test:e2e && test:framework` — but CI (`.github/workflows/ci.yml`) never invokes the root aggregate. Verified per-workspace:

| Suite | Root aggregate | CI (ci.yml) | Runs anywhere? |
|---|---|---|---|
| `ui` vitest (~28 files) | YES (test:ui) | **NO** | locally only |
| `api` vitest (2 files) | YES (test:api) | **NO** | locally only |
| `host` vitest | no | YES (:313) | ✓ |
| `host` Playwright e2e (`test:e2e`) | YES | **NO** | locally only (documented local-only diagnostic — see 052) |
| `packages/everything-dev` | YES | YES (:255) | ✓ |
| `packages/every-plugin` | YES (unit) | YES (:284, `test:all`) | ✓ (integration: CI only) |
| `packages/better-near-auth` | no | YES (:258) | ✓ |
| **`plugins/auth`** (18 integration + 3 unit + 10 colocated UI tests) | **NO** | **NO** | **NOWHERE** |
| **`plugins/proposals`** (753-line lifecycle + migration tests) | **NO** | **NO** | **NOWHERE** |
| **`plugins/registry`**, **`plugins/votes`**, `plugins/_template` | **NO** | **NO** | **NOWHERE** (template: CI via `every-plugin` scaffold only) |
| regression browser/http/framework/unit | no | YES (4 modes / dev+start / :483 / :336) | ✓ (backcompat modes: local only — see 052) |
| `tests/smoke` | no | YES (:664) | ✓ |

## What to do

### Step 1 — CI job for the auth plugin (biggest gap: ~160 real integration assertions on pglite + Better Auth)

Model the job on the existing `framework-tests` job (ci.yml:230) — it already demonstrates the pattern of a workspace test needing a build prerequisite:

```yaml
plugin-tests:
  # auth plugin helpers import createPluginRuntime from every-plugin's dist
  - run: pnpm run build template        # prerequisite train (see ADR 0022)
  - run: pnpm --filter @everything-dev/auth-plugin test
```

Adjust to the job's real shape (checkout/setup-pnpm/DB steps) by copying `framework-tests` and stripping what it doesn't need (it uses pglite via `.env.test`, no compose required for the auth suite's default project — verify by running the command locally first).

### Step 2 — CI job for the small plugins

`plugins/proposals`, `plugins/votes`, `plugins/registry` have test files (`src/__tests__/*.test.ts`) but **no `vitest.config.ts`** (only `plugins/auth` and `plugins/_template` have one). Steps:

1. Add a minimal `vitest.config.ts` to each of the three, modeled on `plugins/_template/vitest.config.ts` (same include pattern; add `pglite`-compatible env handling only if the tests need it — check imports first).
2. Run each locally: `pnpm --filter @everything-dev/proposals-plugin test` (and votes/registry). Fix nothing structural; if a suite is red for a *pre-existing* reason, record it BLOCKED in `docs/plans/README.md` and exclude it from this CI job with a comment — do not fix test failures here.
3. Extend the Step-1 CI job to run all three filters.

### Step 3 — CI job for ui + api vitest

Both suites run locally via the root aggregate but CI never invokes them:

```yaml
ui-api-tests:
  - run: pnpm --filter ui test      # jsdom only, no services required
  - run: pnpm --filter api test
```

Note: `api/package.json:50` carries `--passWithNoTests` although tests exist — that flag masks a future include-pattern regression. Remove the flag in the same change (the suite has 2 real files and must fail loudly if the include glob breaks).

### Step 4 — close the deploy-smoke void

`deploy.yml:260` runs `pnpm --filter host test:integration:remote` as the deploy smoke test. Today the *only* tests that execute from that suite are the two tautologies deleted by plan 050 (`host/tests/integration/runtime-remote.test.ts:97-105`) — everything else `describe.skip`es because the helper reads a `bos.config.json` that this repo no longer has (`bos.app.ts` is the authored config; see `host/tests/helpers/runtime-remote.ts:34`). After 050 lands, the deploy-smoke step runs **zero assertions**. Options (pick one, record the choice in this plan's status note):

- **(a) Point the helper at the authored config**: change `host/tests/helpers/runtime-remote.ts:34` to read the generated `.bos/bos.resolved-config.json` (present after any `bos dev`/`build`) or `bos.app.ts` via the descriptor loader. Keeps the smoke value.
- **(b) Retire the step** from `deploy.yml` and rely on `tests/smoke/runtime-image.mjs` + regression browser `start:*` modes, which already cover the booted stack.

If (a): the remote-scenarios helper's skip-based design means a missing field degrades to skips, not failures — acceptable, but verify the happy path locally once (`pnpm --filter host test:integration:remote`).

### Step 5 — fix the `Bun.sleep` landmine in the stack bootstrap

`tests/regression/lib/start-stack.mjs:61` calls `Bun.sleep` inside a Node-spawned script. On the DB-unreachable retry path it throws `ReferenceError: Bun is not defined`, replacing the intended helpful error at `:54-58`. Replace with a Node timeout (`setTimeout` wrapped in a promise or `timers/promises.setTimeout`). Cheap, verified by reading — do it in this plan because the same file is touched by the wiring work's failure modes.

## Verification

```bash
# Step 1/2/3 prerequisites — each must be green locally BEFORE adding to CI:
pnpm run build template
pnpm --filter @everything-dev/auth-plugin test
pnpm --filter @everything-dev/proposals-plugin test
pnpm --filter @everything-dev/votes-plugin test
pnpm --filter @everything-dev/registry-plugin test
pnpm --filter ui test
pnpm --filter api test

# Step 4 (if option a):
pnpm --filter host test:integration:remote

# Step 5:
node --input-type=module -e "import('./tests/regression/lib/start-stack.mjs')" # parses without Bun
```

CI: trigger the workflow on a PR branch and confirm the new jobs execute the new filters (green or intentionally-BLOCKED-excluded).

## Done criteria

- No suite in the matrix above has "NOWHERE" as its only home (except suites explicitly retired/documented via 052 decisions).
- The deploy-smoke step either executes real scenarios (a) or is removed with the smoke value accounted for (b).
- `--passWithNoTests` removed from `api`'s test script.
- `Bun.sleep` no longer appears anywhere under `tests/`.

## Out of scope

- Deleting any test (plan 050).
- Wiring `backcompat` regression modes or `host test:e2e` into CI — deliberate cost decisions, tracked in plan 052.
- Fixing pre-existing red tests in the newly wired suites (record and exclude instead).

## Maintenance note

Every future plugin added under `plugins/` must be added to the plugin-tests CI job — add a comment at the top of that job listing the current members so the next author notices the list. The root `pnpm run test` aggregate should be revisited once CI owns everything (it currently double-represents ui/api and skips host/backcompat).

## Escape hatches

- If the auth plugin suite cannot run headless in CI (browser-dependent UI project), wire only its backend project: `pnpm --filter @everything-dev/auth-plugin exec vitest run --project backend` and leave the `ui` project documented as local-only.
- If a newly wired suite is red for reasons outside this audit's findings, mark it BLOCKED in `docs/plans/README.md` with the failing command output, keep it out of the CI job, and STOP this step.
