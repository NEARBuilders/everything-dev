# Plan 059: Dev boot — print timings, build plugins in development mode, spawn the host without the ready-barrier

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `docs/plans/README.md` unless the dispatching reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 1e435601..HEAD -- packages/everything-dev/src/cli/commands/dev.ts packages/everything-dev/src/cli/render/dev.ts packages/everything-dev/src/services/dev/orchestrator.ts packages/everything-dev/src/services/dev/session.ts packages/everything-dev/src/services/dev/contract.ts packages/everything-dev/src/services/dev/progress.ts packages/every-plugin/src/build/rspack/plugin.ts packages/every-plugin/src/dev/serve.ts`
> On any mismatch, compare the "Current state" excerpts against the live code before proceeding; on a conflict, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (the NODE_ENV change alters dev bundle output; the host-parallel change alters boot ordering)
- **Depends on**: none (059's timing leg is the measurement baseline for 060/062)
- **Category**: perf / dx
- **Planned at**: commit `1e435601`, 2026-10-28
- **Issue**: https://github.com/NEARBuilders/everything-dev/issues/640

## Why this matters

`bos dev` spends its wall-clock in three places the tool never surfaces: (1) every plugin backend's `rspack build --watch` runs in **production mode** — minified with source maps — because nothing sets `NODE_ENV=development` for dev spawns, multiplying both cold-boot and hot-rebuild cost across 7 watchers; (2) the host — itself the slowest process to boot — cannot even *start* until every non-host service reports ready (a hung child holds the stack up to 120 s), even though the host already carries its own 120 s per-plugin retry budget for cold compiles; (3) phase timings are collected and thrown away, so none of this was measurable. This plan delivers the measurement first, then the two fixes it motivates. It absorbs the dev-pinning leg of the v1-current 001 plan (README, 2026-10-01 session) and delivers the deferred PERF-07 finding from the 2026-09-24 CLI audit ("host spawn gated on slowest plugin: real, need design decisions — next audit").

## Current state

- **Timings exist but are never printed for `bos dev`.** `packages/everything-dev/src/services/dev/progress.ts` records `{name, durationMs}` per phase into `DevResult.timings`. `packages/everything-dev/src/cli/commands/dev.ts:56-69` consumes progress events only to move a spinner label:

```ts
// commands/dev.ts:56-61
const onDevProgress = (event: ProgressEvent) => {
  const label = devPhaseLabels[event.phase] ?? event.phase;
  if (event.status === "running") {
    devSpinner.message(label);
  }
};
```

  After `client.dev(...)` returns, `runDev` never touches `result.timings` (`commands/dev.ts:64-86`). The printer already exists: `packages/everything-dev/src/cli/render/dev.ts:32-44`, `printTimingSummary(timings)` — its only caller today is `bos init` (`cli/commands/init.ts:135`). It imports `formatDuration`/`sumPhaseDurations` from `../../utils/timing`.
- **No NODE_ENV on the dev spawn path.** `packages/everything-dev/src/services/dev/orchestrator.ts:411-423`:

```ts
// orchestrator.ts:411-423 — composeSpawnEnv: FORCE_COLOR and PORT only
export function composeSpawnEnv(
  processEnv: Record<string, string>,
  generatedEnv: Record<string, string>,
  port: number,
  shellEnv: Record<string, string> = {},
): Record<string, string> {
  return {
    ...processEnv,
    ...mergeGeneratedOverFileEnv(generatedEnv, processEnv, shellEnv),
    FORCE_COLOR: "1",
    ...(port > 0 ? { PORT: String(port) } : {}),
  };
}
```

  A full-tree grep of `packages/everything-dev/src/services/dev/` shows NODE_ENV only in unrelated files (infra/docker, materializer, upgrade handlers, build-train, start/boot). `packages/every-plugin/src/build/rspack/plugin.ts:181-187` defaults the mode:

```ts
// every-plugin/src/build/rspack/plugin.ts:181-187
if (!compiler.options.mode) {
  compiler.options.mode = process.env.NODE_ENV === "development" ? "development" : "production";
}
// devtool defaults to "source-map" for non-deploy builds (build/rspack/compose.ts:82)
```

  And `packages/every-plugin/src/dev/serve.ts:153-161` spawns the watcher with the ambient env: `watcher = spawn("rspack", [..., "build", "--watch", ...], { cwd, stdio: "inherit", env: process.env })`. Result: dev watch builds are minified production bundles with source maps, for all 7 plugin backends, on cold boot and every rebuild.
- **The ready-barrier.** `packages/everything-dev/src/services/dev/session.ts:409-437`:

```ts
// session.ts:410-437 (abridged)
const startupPhase = Effect.gen(function* () {
  const nonHostHandles = yield* startGroup(nonHostPackages);
  yield* Effect.forEach(/* all non-host */, ({ handle, pkg }) => awaitReady(pkg, handle), { concurrency: "unbounded" });
  const hostHandles = yield* startGroup(hostPackages);          // ← host starts only after ALL non-host ready
  yield* Effect.forEach(/* host */, ({ handle, pkg }) => awaitReady(pkg, handle), { concurrency: "unbounded" });
  return { nonHostHandles, hostHandles };
});
```

  `awaitReady` (`session.ts:396-408`) is a *soft* gate: on its 120 s timeout it logs "Timed out or failed" and continues. The host tolerates cold remotes independently — `packages/every-plugin/src/remote-entry.ts:21-22` (`POLL_INTERVAL_MS = 300`, `DEFAULT_TIMEOUT_MS = 120_000`) polls `remoteEntry.js` until each plugin's first build lands, used by the host loader (`host/src/services/plugins.ts:457`).
- Host readiness detail: the host descriptor's `readinessPath` is `/health` (`services/dev/service-descriptor.ts:103`); `host/src/program.ts:133-152` returns **200 with `"status": "degraded"`** until composition is ready, and the orchestrator's probe (`services/dev/orchestrator.ts`, HTTP probe, ~200 ms interval) marks ready on any 200.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0 |
| Framework tests | `pnpm run test:framework` | all pass |
| Unit suite for the orchestrator package | `pnpm --filter everything-dev test` | all pass |
| Dev boot smoke | `pnpm run dev` (then Ctrl-C after host prints ready) | all services up; timings printed |
| Regression (after both fixes) | `pnpm run test:db:up && pnpm run test:regression:dev:ssr` | suite green |

## Scope

**In scope** (the only files you should modify):
- `packages/everything-dev/src/cli/commands/dev.ts` (print timings)
- `packages/everything-dev/src/services/dev/contract.ts` (extend timing payload — only if the per-service timings need a new field)
- `packages/everything-dev/src/services/dev/session.ts` (per-service spawn→ready timing capture; host spawn ordering)
- `packages/everything-dev/src/services/dev/orchestrator.ts` (composeSpawnEnv NODE_ENV)
- `packages/everything-dev/src/cli/render/dev-render.ts` (renderer: show degraded host state if needed by Step 4)
- `packages/everything-dev/src/services/dev/*` test files (new tests)

**Out of scope** (do NOT touch):
- `packages/every-plugin/src/build/rspack/plugin.ts` — the mode default is correct; the fix is the caller's env, not the default.
- `packages/every-plugin/src/dev/serve.ts` — it passes `process.env` through correctly; do not hardcode NODE_ENV there (deploy/preview paths share this process).
- The deploy/start build path (`workspace/build-train.ts:278` pins production) — dev sessions only.
- `host/src/program.ts` health semantics.
- The two-phase *grouping* itself (non-host services still start together; only the host barrier changes).
- Per-service restart / reload (that is plan 060).

## Git workflow

- Branch: `feat/dev-boot-timings-parallel-host`
- Commit style: conventional commits, e.g. `perf(dev): print phase + per-service timings in bos dev` / `perf(dev): NODE_ENV=development for dev plugin builds` / `perf(dev): spawn host concurrently with the non-host group`

## Steps

### Step 1 (measurement — do this FIRST, it is the baseline for Steps 3-4): print timings in `runDev`

In `packages/everything-dev/src/cli/commands/dev.ts`, after the successful `result` (around `:77-84`, before `mountSession`), call `printTimingSummary(result.timings)` (import from `../render/dev`). Also capture per-service spawn→ready durations: in `session.ts`'s `awaitReady` (or its caller), record `durationMs` per service into a list attached to the session result (extend `DevResult`/`StartSummary`-adjacent contract in `services/dev/contract.ts` if needed — follow the existing `timings: Array<{name, durationMs}>` shape exactly, e.g. `{ name: "ready api", durationMs }`). Print them with the same `printTimingSummary` (one call, entries ordered by duration descending for readability — or keep insertion order; pick one and stay consistent).

**Verify**: `pnpm run typecheck && pnpm run lint` → exit 0. Then `pnpm run dev` (kill after the host prints ready): the console shows a `Timings:` block listing every phase AND a ready-time per service. Save the output — Steps 3-4 report against it.

### Step 2: `NODE_ENV=development` for dev session spawns

In `orchestrator.ts`'s `composeSpawnEnv`, set `NODE_ENV: "development"` — but ONLY for dev sessions, never when the caller exported NODE_ENV themselves (shell/CI precedence per the function's documented three-tier contract at `orchestrator.ts:404-410`):

```ts
...(shellEnv.NODE_ENV ? {} : { NODE_ENV: "development" }),
```

Confirm every caller of `composeSpawnEnv` on the dev path is a dev session (grep callers; if any shared caller also serves `bos start`, gate on a session-kind parameter instead — check how `FORCE_COLOR` distinguishes contexts today). The deploy train (`build-train.ts`) and `bos start` are untouched because they do not flow through this dev-session `composeSpawnEnv` — verify that claim by grep before relying on it.

**Verify**: `pnpm run dev` → after boot, one plugin's `dist` shows an unminified bundle (e.g. `grep -c "eval\|development" dist/<plugin>/remoteEntry.js` behaves like a dev build, and bundle size drops vs Step 1's baseline); all services still come up; `pnpm run test:regression:dev:ssr` is green (test DBs up via `pnpm run test:db:up`).

### Step 3: empirical guard — confirm nothing depended on production-mode dev output

Before/while Step 2 settles, check the three consumers the audit flagged as possibly tuned to production-mode output, with one running boot each:
1. The dev serve's `remoteEntry.js` 404-window logic (`every-plugin/src/dev/serve.ts` waits for the entry to compile) — watch-rebuild still serves a parseable entry.
2. `ChunkCompletenessPlugin` (`every-plugin/src/build/rspack/chunk-completeness-plugin.ts`) — no new gate failures in watch output.
3. MF manifest chunk-hash stability — SSR loads (`--ssr` boot) still compose.

**Verify**: `pnpm run test:regression:dev:ssr && pnpm run test:regression:dev:csr` → green. If any of the three misbehaves specifically due to development-mode output, STOP and report (see STOP conditions) — do not add conditional modes per-service.

### Step 4: spawn the host concurrently with the non-host group

In `session.ts`'s `startupPhase`, start both groups concurrently and keep the readiness bookkeeping: run `startGroup(nonHostPackages)` and `startGroup(hostPackages)` together (e.g. `Effect.all([...], { concurrency: "unbounded", discard: false })` or zip the two fibers), then `awaitReady` over the union. The host's cold-remote tolerance is already handled by its own 120 s per-plugin budget (`remote-entry.ts`), and `awaitReady` timeouts were already non-fatal — nothing *hard* depends on host-last. Renderer: if the dev renderer displays a service as ready when the orchestrator's `/health`-any-200 probe fires, keep that behavior but ensure the renderer can show the host's `degraded` health state (the probe payload includes `status`) rather than a bare ready checkmark — minimal change in `cli/render/dev-render.ts` following its existing status rendering.

**Verify**: `pnpm run typecheck && pnpm run --filter everything-dev test` → green (orchestrator/session unit tests exist — extend them for the new spawn ordering if a test pins two-phase ordering; update rather than delete). `pnpm run dev` → host appears in the process list before all non-host services are ready; final boot total (Step 1's timings block) is lower than Step 1's baseline. Then `pnpm run test:regression:dev:ssr` → green.

### Step 5: gates

**Verify**:
- `pnpm run test:framework` → all pass
- `pnpm run lint` → exit 0
- `pnpm run build` → exit 0 (deploy-path builds unaffected)

## Test plan

- Unit: extend the dev-session tests (locate them under `packages/everything-dev/src/services/dev/*.test.ts` — e.g. the process-death harness added in #631) with: (a) `composeSpawnEnv` sets `NODE_ENV=development` when shell env omits it and preserves an explicitly exported `NODE_ENV`; (b) startup phase starts both groups concurrently (assert via the existing fake-process harness that host spawn doesn't wait on a stubborn non-host `awaitReady`).
- Structural pattern: model after the existing dev orchestrator tests in the same directory.
- Verification: `pnpm --filter everything-dev test` → all pass including new cases.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm run dev` prints a `Timings:` block (phases + per-service ready times)
- [ ] Dev plugin bundles are unminified (size drop vs baseline; no new regression failures)
- [ ] Host spawn no longer gated on all-non-host-ready (unit test proves it; manual boot shows host listed early)
- [ ] `pnpm run typecheck && pnpm run lint && pnpm run test:framework` all exit 0
- [ ] `pnpm run test:regression:dev:ssr` green
- [ ] Deploy/start paths untouched: `grep -n "NODE_ENV" packages/everything-dev/src/services/dev/orchestrator.ts` shows only the shell-env-respecting dev default
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the Step 3 empirical checks fails in a way attributable to development-mode output (chunk-hash instability, completeness-gate trips, SSR compose failures) — report which consumer and the failure output; production-mode dev builds may be load-bearing for the MF manifest protocol.
- A `composeSpawnEnv` caller turns out to be shared with `bos start` or the deploy train such that the NODE_ENV default could leak into production builds — report the call graph instead of adding a session-kind heuristic unilaterally.
- The regression suite (dev:ssr/dev:csr) fails on host spawn ordering (e.g. a test asserts log ordering that assumed host-last).
- Timings don't materialize in `DevResult` (contract drift since this plan).

## Maintenance notes

- The Step 1 timing surface is the measurement baseline for plans 060 (reload watch) and 062 (single-runtime dev design) — future boot-cost regressions should be judged against printed timings, so keep the printer wired (a regression that silently drops it is a DX regression).
- If a future service kind needs production-mode dev bundles (e.g. an MF-manifest-sensitive fixture), add an explicit per-service opt-OUT in its descriptor rather than weakening the session default.
- Reviewer scrutiny: the `shellEnv.NODE_ENV` precedence line — CI/regression harnesses that export NODE_ENV must win (that is the documented three-tier contract at `orchestrator.ts:404-410`).
- v1-current plan 001 (README, 2026-10-01 session) covered "dev serves pin their build children to development" — this plan delivers that leg; its entry-filename leg remains open there.
