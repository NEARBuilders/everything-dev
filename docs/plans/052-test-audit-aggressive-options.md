# 052 — Test audit: aggressive options and open decisions

Written against commit `d1bc2e3c` (2026-10-11). Companion to plans 050 (conservative removals) and 051 (CI wiring). **Nothing in this plan is recommended for removal as-is** — these are the "if we wanted to be aggressive, could…" options, each with what the cut would buy and what it would risk, plus the audit's open decisions that need a maintainer call. All findings were surfaced by the audit subagents with file:line evidence; MED/LOW confidence means re-verify the cited lines before acting.

## Part 0 — Addendum (2026-10-12, from executing plan 050): broken `every-plugin preview` blocks regression-http locally

**Bug.** `every-plugin preview` for the core `ui` workspace fails with `rsbuild preview: "The output directory /…/ui/dist is empty"` — although `ui/dist` exists with 20+ entries including `index.html` (and `every-plugin build` succeeds immediately before, writing to that exact path). Reproduced standalone:

```bash
pnpm --filter ui exec every-plugin build   # succeeds; ui/dist populated
pnpm --filter ui exec every-plugin preview # fails: "ui/dist is empty"
```

Internal path: `every-plugin/src/cli.ts:73-74` routes core-ui preview to `runCoreUi(["preview", …])` → `rsbuild preview --config .every-plugin/ui.rsbuild.config.generated.mjs`, whose config is `createCoreUiRsbuildConfig(await readAuthoredConfigInput())` (re-exported from `every-plugin/build/ui`, resolved from `packages/every-plugin/dist/build/ui` per ADR 0018). Probing that factory from `ui/` with a proper input resolves `web` dist correctly to `ui/dist` — so the divergence is in what the spawned `rsbuild preview` process actually resolves (cwd, env, or environment selection), not in the authored-config path. **Impact:** `pnpm run test:regression:http` (dev:ssr mode sets `BOS_NO_WATCH=1` → `ui` runs `dev:built` = `every-plugin build && every-plugin preview`, `regression-env.mjs:228` + `service-descriptor.ts:181`) cannot boot locally; the UI service dies and the host probe times out. **CI exposure:** the CI http matrix (ci.yml:347-351) runs the same dev mode, but path-detection skipped the job on recent commits, so it is not yet observed failing there; CI's browser `start:*` modes boot via the deployment image (start-container), not this path. **Fix direction:** debug what cwd/env `runCoreUi` spawns rsbuild preview with vs. the manual probe, and align the dist resolution (or make preview check the resolved factory dist, not the process cwd). Until fixed, `test:regression:http` and `test:regression:browser:dev:*` are local-blocked.

**UPDATE 2026-10-12 (later): no longer reproduces.** Re-running the exact failing chain (`every-plugin build && every-plugin preview`, and direct `rsbuild preview --config .every-plugin/ui.rsbuild.config.generated.mjs` from `ui/`) boots both environments and serves on :3003. The one thing that happened between failure and health: a full `bos typecheck` pass, which regenerates the ui entry stubs (`routeConfig.gen.ts`) the factory consumes. Best surviving hypothesis: the failure was transient generated-stub state (empty/stale stub at preview time), self-healed by regeneration. Kept under observation — if it recurs, the debugging entry point is the `runCoreUi` spawn env vs the manual probe. **Separately and unrelated:** local `test:regression:http` runs are blocked again by the OrbStack daemon being down on this machine (test Postgres on 5434/5435 unreachable) — environment, not repo.

## Part 2 status (executed 2026-10-12)

1. **`near.test.ts:600` — FIXED.** The rejection path exists (`src/index.ts:880-885`: `sessionMiddleware` + explicit 401 "Must be logged in to link NEAR account"); the fake body was replaced with a real no-session POST to `/near/link-account` asserting 401. better-near-auth suite green (129 tests).
2. **`-login.test.tsx` mirrored guard** — still open (needs an import escape hatch or a browser spec; larger than a cleanup).
3. **`plugins/proposals/tests/` — CONSIDERED AND REJECTED.** `tests/types.d.ts` is the scaffold-canonical `RegisteredPlugins` augmentation (`plugins/_template/tests/types.d.ts` ships the same) and is load-bearing for typing; the audit's "stale directory" read was wrong — do not delete.

## Part 1 — Aggressive options (partial-overlap removals)

Deleting any of these trades marginal redundancy for a thinner safety net. Order roughly by confidence.

1. **every-plugin `ui-mf-build.test.ts:19-74` (`describe("createUiSharedDeps")`, 6 tests) ≡ `shared-deps-spec.test.ts:91-204`.** The spec suite iterates all of `UI_SHARED_DEPS` asserting the same fields; ui-mf-build's block is a subset. Buy: one fewer file to maintain. Risk: loses the independent worked example of the shape. Keep at least the `CORE_UI_DEPLOY_FIELDS` test (`:76-81`) which is unique.

2. **everything-dev `extends-chain.test.ts:227-248` and `:267-283`** (plugin-config-only-from-child; canonical ordering) — near-dupes of merge.test.ts:275-318 and :357-372, but the extends-chain versions add one small delta each (shared-ordered-last). Buy: tighter integration file. Risk: the deltas are real; consolidate the deltas into the unit file instead of deleting outright.

3. **everything-dev `storage-upload.test.ts:113-130`** ("exhausts retries on persistent 503s…") ≡ retry file `:62-69` — the retry version adds nothing except omitting the workspace-name assertion. Buy: −1 test. Risk: none beyond losing the message assertion if the retry file's copy isn't extended with it (extend it instead).

4. **host `ssr-federation-error.test.ts:167-187`** (negative failure cache) ≡ `federation-cache.test.ts:224-241` — same seam, same invariant (second load makes zero new `loadRemote` calls). Keep `:189-211` (recovery window) which is unique.

5. **host `ssr.test.ts:93-109`** ("completes full stream render…") is a strict subset of `:70-87`. Buy: −1 slow SSR boot. Risk: minimal.

6. **host `tenant-runtime.test.ts:802-849`** (SSR gating by allowSsr) duplicates `:366-409` + `:315-364` assertion-for-assertion. Buy: −1 heavy integration test. Risk: loses an end-to-end statement of the gating contract if the earlier tests are ever reshaped.

7. **every-plugin `plugin-lifecycle.test.ts:43`** ("usePlugin convenience method" ≡ `:29` same call, same assertions) and **`:90-115`** (caching semantics ≡ `scope-lifecycle.test.ts:516-561`, which is strictly stronger — counts real initialize invocations). Buy: −3 tests. Risk: low.

8. **every-plugin `plugin-router-access.test.ts:93`** ("direct client calls" ≡ `plugin-client.test.ts:38-67`). The file's HTTP/OpenAPI/RPC/streaming tests are the unique value; this one adds nothing.

9. **every-plugin `mf-loading.test.ts:30-53`** (load+instantiate as two tests ≡ `plugin-lifecycle.test.ts:28` full lifecycle) and **`:55`** (invalid ID ≡ `error-handling.test.ts:79`). Buy: integration file shrinks to its manifest-serving tests. Risk: bundling-level failure isolation weakens slightly.

10. **Go `boot_test.go:50-56`** ("root" subtest ≡ `metadata_test.go:10`) and **`:58-74`** (skill_md/llms_txt ≡ `agent_surface_test.go:14-27`, strictly stronger). Buy: −1 test, −1 subtest. Risk: low.

11. **Playwright `dev:ssr` vs `dev:csr` convergence.** Both projects run the identical two specs (`playwright.config.mjs:73-79`: `csr-compose.spec.ts`, `auth-redirect.spec.ts`), all client-side — one mode's result predicts the other's. The config comment ("boot + one page per render mode") doesn't match the testMatch, and `dev:ssr` loads zero SSR'd pages. **Aggressive cut:** drop one dev project. **Better fix (recommended over deletion):** restore the intent — put an SSR'd page spec into `dev:ssr`'s testMatch so the dev tier actually exercises both render modes.

12. **Playwright `app-load.spec.ts` in the `start:csr` project** is variant-blind (nothing in it branches on render variant; start:ssr already runs it). Buy: −1 project run in CI. Risk: the CSR variant does change the served shell, which the hydration checks partially observe — not zero value.

13. **Playwright micro-trims** (LOW-MED): `api-client.spec.ts:28` second test (only incremental value is `pageErrors` equality — fold into test 1); `settings-api-keys.spec.ts` (two trivial page-loads with no interaction — but AGENTS.md cites this spec as the data-testid exemplar, so it has documentation value); `app-load.spec.ts:11` (weakest guard in the suite).

14. **UI borderlines (LOW):** `plugins/auth/ui/.../-api-key-dialogs.test.tsx:46` (prop echo, but the fixture deliberately makes `start` ≠ `key`, so it catches a real display bug — rename the test, don't delete); `ui/.../-custom-ui-bundle-fields.test.tsx:139-154` (pure `disabled` passthrough loop — cheap to keep); `packages/everything-dev/tests/ui/api.test.ts:158-172` (context pass-throughs — MED); `tests/ui/hydrate.test.tsx:143-155` (mock pass-through — LOW; typecheck would catch its failure mode).

## Part 2 — Broken or misnamed tests to fix (not delete)

*(Status recorded in "Part 2 status" above — item 1 fixed, item 3 rejected; item 2 remains open.)*

1. ~~**`packages/better-near-auth/src/near.test.ts:600-604` "should reject linking without a session"**~~ — FIXED (see Part 2 status).

2. **`plugins/auth/ui/src/routes/_public/-login.test.tsx:60-65`** — tests the "no redirect loop" invariant against a *hand-mirrored* copy of the core `_authenticated` guard (the plugin test tree can't import core sources). If `ui/src/lib/auth-guards.ts` changes, these tests stay green while production breaks. **Action:** either add an import escape hatch (shared test fixture package) or add a `tests/regression/browser/` spec covering the real guard pair (the repo's preferred layer for this).

3. ~~**`plugins/proposals/tests/`**~~ — CONSIDERED AND REJECTED (see Part 2 status): the `types.d.ts` augmentation is scaffold-canonical (`_template` ships the same) and load-bearing.

## Part 3 — Open decisions (need a maintainer call)

1. **Host `runtime-remote` suite is dead by config drift.** The helper (`host/tests/helpers/runtime-remote.ts:34`) reads `bos.config.json`, which this repo no longer has (authored config is `bos.app.ts`), so every scenario `describe.skip`es forever; the only CI caller (deploy.yml:260 smoke) currently runs just the two tautologies plan 050 deletes. **Decision:** repair (point the helper at `.bos/bos.resolved-config.json` / the authored config — plan 051 step 4 option a) or retire the suite (option b). Repair preserves remote-smoke value; retirement removes a 334-line helper nobody can currently exercise.

2. **`backcompat` regression modes (browser + http + stack) never run in CI.** Scripts exist and are coherent (`package.json:49,52,72`); the CI matrices (ci.yml:500-512, 347-351) omit them. The backcompat topology (local host/auth + remote ui/api) is genuinely distinct from dev and start. **Decision:** add a periodic/scheduled CI run, accept manual-only with a docs note, or delete the modes. Cutting a distinct topology without a replacement is the one aggressive option this audit advises against.

3. **`docs/plans/done/db-auth-absorption-prototype/tests/absorption.test.ts`** — a vitest file inside the done/ archive; unreachable by any wired path (prototype dir is not a workspace member; no config includes `docs/`). The code it tests still exists. **Decision:** leave as an archived primary source (recommended — it's inside `done/` for a reason) or delete with the archive.

4. **`host/tests/e2e/runtime-remote.spec.ts`** — documented "Local-only diagnostic — NOT wired into CI by decision"; its browser-only tests (DOM hydration, SPA nav, theme toggle) are unreplaceable by the vitest suite, its first test overlaps the vitest smoke file. **Decision:** keep as-is (recommended — the header says the quiet part), or move its unique browser assertions into `tests/regression/browser/` where CI would protect them.

## Done criteria (when parts of this plan are executed)

Whatever subset is chosen: affected workspace test commands green, no deleted test name greppable, and each decision above recorded in `docs/plans/README.md` status column (DONE / REJECTED with one-line rationale).
