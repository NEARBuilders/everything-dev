# Plan 015: Characterization tests for the CLI's process-management core

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- packages/everything-dev/src/orchestrator.ts packages/everything-dev/src/dev-session.ts packages/everything-dev/src/infra/preflight.ts packages/everything-dev/src/cli.ts packages/everything-dev/tests`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (but land BEFORE plan 012's replacer work touches adjacent upgrade code — no file overlap, order is soft)
- **Category**: tests
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

The CLI's riskiest code — child-process lifecycle and signal handling, where a regression hangs or orphans dev servers — has **zero test coverage**. Repo-wide search over `packages/everything-dev/tests` for `orchestrator|dev-session|preflight|runDevSession|spawnDevProcess` matches only `tests/unit/dev-status-detection.test.ts:2` (imports `detectStatus` alone). These files were just rewritten in the Effect 4 migration (commit `a2c07ec8`: orchestrator ported from `@effect/platform` to plain `child_process.spawn`, high churn) with no safety net. This plan adds characterization tests only — no behavior change.

## Current state

- `packages/everything-dev/src/orchestrator.ts:294-455` — `spawnDevProcess` and friends: spawn (`child_process.spawn(command, args, { cwd, env, stdio: ["ignore","pipe","pipe"], detached: true })`), probe deadline, **exit-before-ready race** (child dies while the caller awaits readiness), kill escalation (**SIGTERM → 3s timeout → SIGKILL**, using `exitCode.pipe(Effect.timeout("3 seconds"), Effect.option)` on Effect 4), stream piping (`Readable.toWeb(cmd.stdout)` → `Stream.fromReadableStream({ evaluate, onError })` → `Stream.decodeText` → `Stream.splitLines`).
- `packages/everything-dev/src/dev-session.ts:330-377` — signal handling: SIGINT/SIGTERM double-signal force-exit (second signal during shutdown kills immediately), `emergencyKill` process-group kill.
- `packages/everything-dev/src/infra/preflight.ts:106-152` — env-target parsing + failure messages.
- `packages/everything-dev/src/cli.ts:157-208` — command dispatch/parse wiring.
- Effect 4 idioms in these files: `Effect.callback<number, Error>` with `cmd.once("exit"/"error")`, `Effect.gen`, `Effect.timeout`, `Effect.option`.
- Existing exemplar test: `packages/everything-dev/tests/unit/dev-status-detection.test.ts` — the one existing test touching this area; model file layout/imports on it.
- Test runner: vitest (`packages/everything-dev` vitest config; `bun run test` at package root runs unit + integration).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| everything-dev tests | `cd packages/everything-dev && bun run test` | 420+ existing + new pass (2 skipped) |

## Scope

**In scope** (test files only — this plan changes NO source):
- `packages/everything-dev/tests/unit/orchestrator.test.ts` (create)
- `packages/everything-dev/tests/unit/dev-session-signals.test.ts` (create)
- `packages/everything-dev/tests/unit/preflight.test.ts` (create or extend)
- `packages/everything-dev/tests/unit/cli-dispatch.test.ts` (create, only if Step 5 is cheap)

**Out of scope**:
- Any file under `packages/everything-dev/src/` — characterization only. If a test reveals a bug, that's a STOP-and-report, not a fix.
- `tests/regression/**` (browser/HTTP stacks — separate infra).
- The `bos ps`/PID-registry code paths.

## Git workflow

- Branch: `improve/015-orchestrator-tests`.
- Commit style: `test(everything-dev): characterize orchestrator, signals, preflight`.
- Do NOT push unless instructed.

## Steps

### Step 1: Read the modules and map the seams

Read `orchestrator.ts` (spawn/exit/kill paths), `dev-session.ts` (signal handling), `preflight.ts`. Identify the spawn seam: the modules call `child_process.spawn` directly — the tests will either (a) spawn REAL trivial children (`node -e "..."` sleep/exit scripts — preferred: no source change needed, and timing is controllable), or (b) need dependency injection (a source change — out of scope, so prefer (a)). Prefer (a) throughout.

**Verify**: no command; record the seam decision in your report.

### Step 2: Orchestrator characterization tests

In `tests/unit/orchestrator.test.ts`, using real `node -e` children:
1. **Happy path**: spawn a child that becomes "ready" (prints the readiness marker the orchestrator waits for — read the code for the exact probe mechanism) → resolves ready, stdout lines flow to the callback.
2. **Exit-before-ready race**: child exits immediately (non-zero) → the spawn effect FAILS with the exit-error shape (read the code for the exact error class/shape; assert on it).
3. **Kill escalation**: spawn a child that traps SIGTERM and ignores it (`node -e "process.on('SIGTERM', ()=>{}); setTimeout(()=>{}, 60000)"`), then kill → SIGTERM ignored → after the 3s timeout the SIGKILL lands → child exits; assert total time is bounded (use generous vitest timeouts; the escalation constant is 3s — read it from the code and parameterize if injectable, otherwise accept ~3s test duration for this one case).
4. **Stream piping**: child prints multi-line stdout → the onLine callback receives each line separately (splitLines behavior).

**Verify**: `cd packages/everything-dev && bunx vitest run tests/unit/orchestrator.test.ts` → 4 cases pass.

### Step 3: Signal-handling characterization

In `tests/unit/dev-session-signals.test.ts` (real child processes, signal the TEST process's handlers via the module's exported API — read `dev-session.ts:330-377` for how `runApp` registers handlers; test via the module's own entry, sending signals to a child it manages):
1. Single SIGINT → graceful shutdown path runs, child exits.
2. **Double-signal force-exit**: two SIGINTs in quick succession → immediate force kill (child killed without waiting for graceful timeout).
3. `emergencyKill` kills the process GROUP (spawn a child that itself spawns a grandchild; assert the grandchild dies too — `detached: true` + group kill is the property).

**Verify**: `bunx vitest run tests/unit/dev-session-signals.test.ts` → 3 cases pass; no orphaned processes after the run (`ps` shows no leftover `node -e` children — clean up robustly in afterAll).

### Step 4: Preflight characterization

In `tests/unit/preflight.test.ts`:
1. Env parsing: `API_DATABASE_URL=postgres://...` produces the right probe target; URLs without ports get defaults (read the parser for exact rules).
2. Unreachable target → the failure message contains the host/port and the remediation hint (assert on message substrings that are load-bearing UX).
3. Non-postgres URL schemes (e.g. pglite:) are skipped (read the code: the preflight probes `*_DATABASE_URL` — check how pglite URLs are treated and pin whatever it does today).

**Verify**: `bunx vitest run tests/unit/preflight.test.ts` → cases pass.

### Step 5: Full suite + orphan check

Run the whole package suite; confirm no leaked processes and no port conflicts (the orchestrator tests spawn on random/no ports — verify the spawn args in the code use no fixed ports).

**Verify**: `cd packages/everything-dev && bun run test` → all green; `pgrep -f "node -e" | wc -l` → 0 after the run.

## Test plan

This plan IS the test plan (characterization: happy path, exit-before-ready race, kill escalation, double-signal force exit, group kill, preflight parsing + failure UX). Each case pins CURRENT behavior — if an assertion can't be written because behavior is unclear from code, run the real scenario and pin what actually happens.

## Done criteria

- [ ] New test files exist with the listed cases; all pass
- [ ] `cd packages/everything-dev && bun run test` green (420+ existing unchanged)
- [ ] No source files modified (`git status` — only new test files)
- [ ] No orphaned processes after the suite
- [ ] `bun typecheck`, `bun lint` exit 0
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- A characterization test reveals actual buggy behavior (e.g. kill escalation never fires, or the double-signal path deadlocks) — do NOT fix the source; write the test to pin the observed behavior only if it's benign, otherwise mark it `test.skip` with a TODO comment citing the observed bug and report it for a fix plan.
- Real-child tests prove flaky on CI-like timing (3s escalation + signal races) — prefer marking the timing-sensitive cases `describe.skipIf(process.env.CI)` over deleting them; report what was gated.
- The modules' exports don't expose the seams the tests need without source changes — report which export would be needed (a minimal export-only source change may be acceptable; ask via the report rather than deciding).

## Maintenance notes

- These tests guard the `@effect/platform` re-adoption when Effect 4 platform ships — the kill/signal semantics are exactly what that migration must preserve.
- Reviewer: check the afterAll cleanup actually kills children even on assertion failure (`try/finally` or vitest auto-teardown hooks).
- The interleaved codemod fixture (plan 012) pairs with these as the two test-first plans of this batch.
