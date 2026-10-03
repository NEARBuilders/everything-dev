# Plan 040: Verification & speed — the framework suite runs by default, boots stop waiting on the network, tests stop doing real fetches

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the plans index.
>
> **Drift check (run first)**: `git diff --stat c26e8699e..HEAD -- package.json packages/everything-dev/package.json packages/everything-dev/vitest.config.ts packages/everything-dev/src/cli.ts packages/everything-dev/src/cli/status.ts packages/everything-dev/src/dev-program.ts packages/everything-dev/src/build.ts packages/everything-dev/tests/unit/composable-entry.test.ts packages/everything-dev/tests/unit/config-resolved.test.ts`
> Plan 037 touches `cli.ts`? No. Plan 038 touches `dev-program.ts` (expected drift at the env-application site — Steps here are spawn-order and build-order, disjoint). Other drift: STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW-MED (test-isolation changes can surface module-state leaks; startup-order changes alter first-output timing)
- **Depends on**: none (ordering independent of 037-039; characterization coverage remains plan 015's job — this plan does NOT duplicate it)
- **Category**: tests, perf
- **Planned at**: commit `add676edc`, 2026-09-23

## Why this matters

`bun run test` at the repo root never executes the CLI package's own 600-test suite — a developer (or agent executor) validating a CLI change gets a green run that proves nothing about the CLI. The suite itself costs ~41s of which ~38s is module importing (per-file fork isolation re-imports the effect + every-plugin source graph 58 times), and two config test files do real network fetches with exponential-backoff retries (~55s of aggregate test time, environment-sensitive results). On the startup path, `bos dev`/`bos start` await an "is this package outdated" check (npm registry + FastKV, up to ~10s with retries) before spawning a single service, and the on-boot staleness walk + serialized quiet builds add further avoidable latency. This plan makes verification honest and fast and removes dead network time from every dev boot.

## Current state

- **Root `package.json`** — `"test": "bun run test:ui && bun run test:api && bun run test:e2e"`; no framework suite. CI runs it in a path-gated job (`.github/workflows/ci.yml:219-220`).
- **`packages/everything-dev/vitest.config.ts:5-11`** — no pool/isolate options; default per-file isolation. Measured (read-only run at planning time): 58 files/526 tests, Duration 41.01s (transform 5.54s, **import 37.81s**, tests 88.15s aggregate); a 2-trivial-file control run: 552ms wall. `tsconfig.json:6-19` maps `every-plugin/*` to workspace source via `vite-tsconfig-paths`, so tests importing `src/types`/`config`/`plugin` pull the every-plugin graph + effect v4 through vite transform each time.
- **`tests/unit/composable-entry.test.ts`** (measured 15.2s) and **`tests/unit/config-resolved.test.ts`** (measured 39.8s) — fixture configs with remote URLs; `loadResolvedConfig` triggers real `fetchWithRetryEff` (1s→15s cap backoff, `src/http-client.ts:41-42,103-128`) and `fetchApiPluginManifest` retries (`src/api-contract.ts:83-94`); stderr shows real `Network error: http://localhost:3001/plugin.manifest.json — fetch failed`. The existing mock pattern to copy: `vi.mock("../../src/fastkv")` in `tests/unit/remote-config-resolution.test.ts:7`.
- **`src/cli.ts:210,253,300,476`** — `warnIfOutdated(client, command)` fired async but then **awaited** before `devApp(...)` / `startApp(...)`: `await outdatedWarning` gates service spawn on `client.status()` → npm registry fetch (10s timeout) + `fetchBosConfigFromFastKv` (3 retries) when `extends` is `bos://`.
- **`src/dev-program.ts:222-228`** — three quiet builds: `Promise.all([everythingDev, betterNearAuth])` awaited, THEN `buildEveryPluginQuietly` serialized after (independent work); `isWorkspaceDistStale` (`src/build.ts:601-613`) does a full recursive mtime walk of each package's src tree per boot.
- **`src/infra/materializer.ts:216-231` + `cli/infra.ts:172-186`** — the generated-infra spec (secret groups, origins, DB/redis configs, `loadPortState`) is computed 3-5× per boot (materializeTestInfra, materializeCompose, materializeTemplate, plus the planner's own pass).
- **Conventions**: vitest; `bun run test` (root, NEVER `bun test`); changesets for user-facing changes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Framework suite | `bun run --cwd packages/everything-dev test` | all pass |
| Root suite (new) | `bun run test` | exit 0, now INCLUDING the framework suite |
| Timing measurement | `cd packages/everything-dev && time bun run test` | wall-clock recorded before/after each step |

## Scope

**In scope**:
- `package.json` (root — test chain)
- `packages/everything-dev/vitest.config.ts`
- `packages/everything-dev/tests/unit/composable-entry.test.ts`, `config-resolved.test.ts`
- `packages/everything-dev/src/cli.ts` (outdated-warning await sites only)
- `packages/everything-dev/src/dev-program.ts` (build parallelization site only)
- `packages/everything-dev/src/infra/materializer.ts` + `cli/infra.ts` (spec computed once — coordinate with 038 Step 3 which edits the same builder)
- `.github/workflows/ci.yml` (if the framework job needs adjusting after the root-chain change)

**Out of scope**:
- Characterization tests for dev-session/orchestrator teardown — **plan 015 owns these** (`advisor-plans/015-orchestrator-characterization-tests.md`, TODO); do not start them here
- Port allocation / planner semantics (036/038)
- The `publish.subprocess.test.ts` dist-CLI smoke (TEST-04) — valuable but needs a build-budget decision; recorded in Maintenance notes as the follow-up

## Steps

### Step 1: Root test chain includes the framework suites (TEST-05)

Root `package.json`: add `"test:framework": "bun run --cwd packages/everything-dev test && bun run --cwd packages/every-plugin test"` (verify every-plugin's script name from its package.json) and chain it into `"test"` (order: framework first or last — pick last so UI/API failures surface fastest; document the added ~1-2 min in the script's PR description). Check CI's path-gated job still makes sense (it can become the fast-path; the root chain is the honest default).

**Verify**: `bun run test` at root → exit 0 AND the run log shows the everything-dev suite executing (grep the output for a known framework test name, e.g. `parse`).

### Step 2: Stop gating service spawn on the outdated check (PERF-01)

`src/cli.ts`: remove the `await outdatedWarning` before `devApp`/`startApp` (lines ~253, ~300, ~476). Keep firing `warnIfOutdated` (fire-and-forget) so the warning still prints when it resolves — AFTER services have started spawning. Guard: when the warning resolves post-spawn in interactive mode, it must not corrupt the TUI — print via `process.stderr` (the renderer owns stdout) or hold it until the session ends; stderr is simplest and correct (interactive TUI writes to stdout only).

**Verify**: package tests; manual `bun run dev` with network blocked (e.g. `sudo`-less offline or a fast fail) — services begin spawning immediately, warning arrives late or never, no hang.

### Step 3: Stub the network in the two slow config test files (PERF-06)

In `composable-entry.test.ts` and `config-resolved.test.ts`, `vi.mock("../../src/http-client")` returning fast 404-shaped failures (model on `remote-config-resolution.test.ts`'s fastkv mock), OR point fixture URLs at a closed localhost port and inject `retries: 0` where the fetch options allow. Target: both files complete in <2s combined and produce identical assertions (they test merge/resolution logic, not fetch behavior).

**Verify**: `time bun run test -- composable-entry config-resolved` → <2s combined, all pass; full suite time drops accordingly.

### Step 4: Collapse the import tax (PERF-05 — measure first, keep what wins)

Try, one at a time, measuring after each (record numbers in the PR):
a. Replace `vite-tsconfig-paths` with vite's native `resolve.tsconfigPaths` (vitest prints the suggestion already).
b. `pool: "forks"` + `poolOptions.forks.singleFork: true` + `isolate: false` — CAUTION: module-level state (`src/config.ts:45-55` config cache, `src/http-client.ts:132` GET cache) may leak across files in one worker; if the suite goes red, isolate the stateful test files (`config-resolved`, `composable-entry`, any test mutating `process.env` without restore) into a separate worker via `vitest`'s per-file pool comments or keep isolation for just those files.
Keep only the steps that measurably win without red tests.

**Verify**: full suite green; wall-clock improvement recorded (expect ≥2× if 4b lands).

### Step 5: Parallel quiet builds + spec computed once (PERF-03/04)

`dev-program.ts:222-228`: run all three quiet builds in one `Promise.all`. `infra/materializer.ts`/`cli/infra.ts`: compute `GeneratedInfraSpec`/`PortState` once in `planInfra` and pass it into `materializeViaLayer` (optional precomputed parameter on the materializer shape) — coordinate with 038 Step 3 which edits `buildDatabaseConfigs` in the same file; land whichever plan executes second with a drift re-check.

**Verify**: `bun run test -- infra materializer` pass; manual boot: one `[env]`/spec derivation visible per run (add a debug-timed assertion only if a test already covers it — do not add new timing tests).

## Test plan

- No new test files except where Step 3 converts network calls to mocks (assertions unchanged).
- Step 1's "verify" is itself the test (root chain runs the suite).
- Record before/after timings for Steps 3-5 in the PR body (numbers, not judgments).

## Done criteria

- [ ] `bun run test` at root exits 0 and provably executes the everything-dev suite
- [ ] `grep -n "await outdatedWarning" packages/everything-dev/src/cli.ts` → no matches
- [ ] `composable-entry` + `config-resolved` combined runtime < 2s (recorded)
- [ ] Full framework suite runtime recorded before/after (target: ≤ 20s; keep whatever wins)
- [ ] `bun typecheck`, `bun lint` exit 0
- [ ] Changeset for the user-facing startup-latency fix (Step 2)

## STOP conditions

- Step 4b's isolation change surfaces a module-state leak that can't be fixed by isolating ≤3 named files — revert 4b, keep 4a, report the leaking modules.
- Step 2's late warning corrupts the interactive TUI in a way stderr routing doesn't solve — report; do not silently drop the warning.
- CI's framework job and the new root-chain step conflict (double-run timeouts) — report the CI layout before editing workflows beyond the mechanical fix.

## Maintenance notes

- **Follow-up (TEST-04, not scheduled)**: resurrect `tests/integration/publish.subprocess.test.ts` (currently `describe.skip`) as a CI-gated dist-CLI smoke (`--help`, `config`, `publish --dry-run` with a stub key) behind the `init.full.test.ts:22` skipIf pattern — the stale-dist crash class has no automated tripwire.
- Plan 015 remains the owner of bootstrap/teardown characterization; if 015 executes after 037, its scope should shrink (037 Phase 4 already covers the session-level cases).
- PERF-02 (every command eagerly resolves full config incl. remote manifests — `bos ps` pays network) and PERF-07 (host spawn gated on slowest plugin) are real but need a design decision (lazy-config flag; readiness model) — recorded for the next audit, not planned here.
