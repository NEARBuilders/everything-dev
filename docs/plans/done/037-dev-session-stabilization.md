# Plan 037: Dev-session stabilization — quit works at every phase, teardown never orphans, TUI never garbles

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c26e8699e..HEAD -- packages/everything-dev/src/dev-session.ts packages/everything-dev/src/orchestrator.ts packages/everything-dev/src/components/dev-render.ts packages/everything-dev/src/dev-log-pipeline.ts packages/everything-dev/src/dev-logs.ts`
> NOTE: `c26e8699e` commits the ticket-05 implementation (quit escalation via
> `DevSessionControls`, viewport-bounded repaint in `dev-render.ts`,
> `service-descriptor.ts` `satisfies` fix) that this plan was written against.
> Read `.scratch/quiet-dev-session/issues/05-tui-quit-escalation.md` for that context.
> Any further in-scope drift: compare "Current state" excerpts to live code; on
> mismatch beyond ticket-05 work, STOP.

## Status

- **Priority**: P1 (Phase 1 is a live-user-blocking hotfix — land it first, alone if needed)
- **Effort**: M
- **Risk**: MED (process lifecycle; mitigated by Phase 4 characterization and the small-step ordering)
- **Depends on**: none (executes BEFORE plan 036 Phase 0 — 036's characterization must pin the fixed quit behavior, not the bugs)
- **Category**: bug
- **Planned at**: commit `add676edc`, 2026-09-23 (+ uncommitted ticket-05 working-tree changes)

## Why this matters

Two live incidents triggered this plan: (1) a user could not quit a `bos dev` session — Ctrl+C appeared dead and the session had to be killed externally; (2) the interactive TUI produced progressively garbled frames (residue of previous frames bleeding through rows). The audit found the quit path is broken at *specific lifecycle phases* (during startup, on force-exit with a remote host), shutdown messages are written into the alt-screen where they're invisible, the renderer keeps painting after unmount, non-TTY mode silently freezes after 100 log events, and `bos dev` always exits 0 so harnesses can't detect failure. Together these manufacture the "zombie sessions squatting ports" class that plan 036's registry work then has to clean up. This plan makes quit deterministic at every phase and the TUI display sound.

## Current state

All paths relative to `packages/everything-dev/src/`. Line numbers are post-ticket-05 (uncommitted) and may drift a few lines — match on the quoted code, not the number.

- **`dev-session.ts`** — the session lifecycle. Key shapes:
  - `DevSessionControls` (≈line 51): `{ requestShutdown, emergencyKill, requestShutdownEscalating, forceExit, restoreView }` — the last three were added by ticket 05; `requestShutdownEscalating`/`forceExit` are assigned by `runApp`'s `onShutdownReady` callback, `restoreView` is assigned after the renderer is created.
  - Startup ordering (≈210-231): `startGroup(nonHostPackages)` → `awaitReady` loop (each `Effect.timeout("120 seconds")`) → `startGroup(hostPackages)` → second `awaitReady` loop → **only then** `childPids`/`controls.emergencyKill` assignment (≈239) → `Effect.addFinalizer` (≈261) → `Deferred.await(shutdown)` (≈301). Nothing observes the shutdown Deferred before the last line, and `emergencyKill` is still a `{}` no-op stub during both awaitReady windows.
  - Finalizer body (≈261-299): kill all handles (concurrent, `Effect.ignore`) → `Effect.sleep("200 millis")` → `view?.unmount()` → `unregisterPid` → `pipeline.flush()` → optional log export via `console.log`.
  - `runApp` (≈305-382): `forceExit = () => { console.log("\n[Dev] Force exit"); controls?.restoreView(); controls?.emergencyKill(); process.exit(0); }` (restoreView was added by ticket 05 but runs AFTER the console.log), `handleSignal` + `requestShutdownEscalating` both `console.log("\n[Dev] Shutting down...")` while the alt-screen is still active, and the completion handler ends `process.exit(Exit.isSuccess(exit) ? 0 : 0)` — both branches zero. `Effect.catchDefect` (≈340) logs the defect and returns success.
- **`orchestrator.ts`** — `spawnRemoteHost` (≈270) returns `pid: process.pid` for in-process remote hosts; `spawnDevProcess` (≈328) spawns `detached: true` (≈363); per-child kill escalates SIGTERM→3s→SIGKILL (≈510-522); `detectStatus` (≈80-89) checks errorPatterns before readyPatterns.
- **`components/dev-render.ts`** — the ANSI renderer (ticket 02 + 05). `repaint()` (≈407) writes `\x1b[H${frame}\x1b[J` where frame = clipped lines joined with `"\n"` — **no per-line `\x1b[K` erase**. `unmount` (≈443) removes stdin/resize listeners and restores the terminal but does not stop `setState`→repaint (the `listeners` array still holds the repaint fn). The non-interactive path's `addLog` caps `state.logs` at 100 (`slice(-100)`, ≈304) while `printChanges` (≈349-352) prints `state.logs.slice(printedLogCount)` — once `printedLogCount` reaches 100 the slice is empty forever. `setRawMode?.(true)` (≈440) is unguarded.
- **`dev-logs.ts`** — log filename `dev-${ts}.log` (second granularity, ≈44) and `dev-latest.log` truncated per session start (≈52); writes are a fire-and-forget promise chain (`void logger.write(event)` in dev-session.ts ≈141).
- **Conventions**: Effect 4 (`Effect.gen`, `Effect.acquireRelease` where natural); no code comments in implementation; kebab-case files; tests in `tests/unit/` (vitest), renderer tests model on `tests/unit/dev-render.test.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Package tests | `cd packages/everything-dev && bun run test` | all pass (baseline ≈604) |
| Package dist | `cd packages/everything-dev && bun run build` | success |
| CLI smoke | `node packages/everything-dev/dist/cli.mjs ps` | runs, lists processes |

## Scope

**In scope**:
- `packages/everything-dev/src/dev-session.ts`
- `packages/everything-dev/src/orchestrator.ts` (pid/detectStatus/spawn-error sites only)
- `packages/everything-dev/src/components/dev-render.ts`
- `packages/everything-dev/src/dev-logs.ts` (filename change only)
- `packages/everything-dev/tests/unit/dev-render.test.ts`, `tests/unit/dev-session.test.ts` (create), `tests/unit/dev-status-detection.test.ts`

**Out of scope**:
- Port allocation, registry locking, `bos kill` escalation — owned by plan 036 (`docs/plans/036-port-leases-and-scoped-stack.md`)
- CORS/BASE_URL/env precedence, preflight, DB ports — owned by plan 038
- Log pipeline classification logic (ADR 0016, landed) — only its consumers here
- The `l`-key semantics (export-and-quit is intentional; only the "l logs" hint wording may be adjusted to "l export+quit")

## Steps

### Phase 1 — Hotfix: display correctness (land alone, immediately)

**Step 1.1: Per-line erase in repaint (BUG-02 — the garbled screen).**
In `dev-render.ts` `repaint()`, change the frame construction so every line ends with `\x1b[K` (erase-to-end-of-line) before the join newline, keeping the trailing `\x1b[J`:

```ts
const repaint = () => {
  const maxRows = viewportRows() - 1;
  const lines = renderDevLines(state).slice(0, maxRows);
  const cols = viewportCols();
  const frame = lines.map((line) => `${clipLine(line, cols)}\x1b[K`).join("\n");
  output.write(`\x1b[H${frame}\x1b[J`);
};
```

**Verify**: `cd packages/everything-dev && bun run test -- dev-render` → pass.

**Step 1.2: Renderer dead after unmount (BUG-06) + flush before unmount.**
In `createDevRenderer`, add a mounted flag and route all state changes through it:

```ts
let mounted = true;
const stopListeners = () => {
  mounted = false;
  listeners.length = 0;
};
const setState = (mutate: () => void) => {
  if (!mounted) return;
  mutate();
  for (const listener of listeners) listener();
};
```

The default `handle.unmount` becomes `() => { stopListeners(); }`; the interactive override calls `stopListeners()` first, then the existing raw-mode/alt-screen restore. (Unmount thus becomes idempotent — safe to call from both `restoreView` and the finalizer.)
In `dev-session.ts` finalizer, move `pipeline.flush()` BEFORE `view?.unmount()` so the final drained events render inside the alt-screen, and the export block (console.log) still runs after unmount. Final order: kills → sleep → `unregisterPid` → `pipeline.flush()` → `view?.unmount()` → export.

**Verify**: package tests pass; manual smoke (below) shows no frame painted after quit.

**Step 1.3: Shutdown messages out of the alt-screen (BUG-09).**
In `dev-session.ts`: `forceExit` calls `controls?.restoreView()` BEFORE `console.log("\n[Dev] Force exit")`. Both `requestShutdownEscalating` and `handleSignal` call `controls?.restoreView()` (or the non-interactive no-op) before `console.log("\n[Dev] Shutting down...")`. With Step 1.2's idempotent unmount, the finalizer's later `view?.unmount()` is safe.

**Verify**: `bun run test -- dev-render` and typecheck pass; manual smoke: first `q` press visibly prints "[Dev] Shutting down..." on the normal screen and the terminal is restored immediately.

**Phase 1 gate**: `bun typecheck`, `bun lint`, package tests, `bun run build`, and a manual smoke (`bun run dev` in a real terminal: verify no residue when the summary line shrinks from "N/M ready" to "All N services running", quit via single `q`, quit via double Ctrl+C). Add a changeset (user-facing fix).

### Phase 2 — Quit correctness at every lifecycle phase

**Step 2.1: Quit during startup must kill what has spawned (BUG-01).**
Restructure `runDevSession` so a shutdown request during the awaitReady phases interrupts startup and tears down spawned handles. Recommended shape: collect handles into a `Ref` (or plain array) as each `startProcess` resolves; assign `controls.emergencyKill` incrementally (it already reads a closure — make it read the growing list); race each awaitReady group against `Deferred.await(shutdown)` with `Effect.raceFirst`, and after any shutdown win, run the same kill-all finalizer path (add the finalizer BEFORE the first spawn via `Effect.addFinalizer` at the top of the scope, killing whatever is in the list). The `Effect.addFinalizer` at scope top is the key move: it guarantees a kill path exists from the first spawned child onward.
Do NOT change `STARTUP_ORDER` semantics or the remote-host `serverHandle.shutdown()` kill path.

**Verify**: new `tests/unit/dev-session.test.ts` — fake `makeDevProcess` returning never-ready handles; trigger `controls.requestShutdown()` during the awaitReady window; assert every fake handle's `kill` ran. See Test plan.

**Step 2.2: Remote-host self-SIGKILL (BUG-04).**
`orchestrator.ts` `spawnRemoteHost` (≈272): change `pid: process.pid` to `pid: undefined` (the remote-host kill path already goes through `serverHandle.shutdown()`, not signals). Belt-and-braces: in `dev-session.ts` `childPids` filter, also exclude `pid === process.pid`.

**Verify**: `grep -n "pid: process.pid" packages/everything-dev/src/orchestrator.ts` → no matches in handle-returning positions.

**Step 2.3: Exit codes (BUG-07).**
`dev-session.ts` completion handler: `process.exit(Exit.isSuccess(exit) ? 0 : 1)`. In `runApp`'s `Effect.catchDefect`, log AND fail the effect (e.g. `Effect.sync(...).pipe(Effect.andThen(Effect.fail(...)))` or `Effect.die` preserved into the exit) so defects surface as non-zero. Check `tests/regression/lib/start-stack.mjs` expectations and the CI workflows for exit-code assumptions on `bos dev` before changing (regression stack treats non-zero spawn exit as failure — that is the desired new behavior; adjust fixtures if they asserted 0-on-crash).

**Verify**: package tests + root `bun run test` (regression lib tests) pass.

**Step 2.4: Suspend the 5s force timer during the finalizer (BUG-16).**
In `runApp`, clear `forceExitTimer` when the program completes normally (already done) AND when the finalizer starts: expose `controls.requestShutdownEscalating`'s timer via a `suspendForceTimer` hook the session finalizer calls, then re-arm a fresh 5s budget at finalizer entry so a genuinely-hung finalizer still dies. Simplest: `forceExitTimer` lives on `runApp`; add `controls.suspendForceExitTimer = () => { if (forceExitTimer) clearTimeout(forceExitTimer); forceExitTimer = setTimeout(forceExit, 5000); }` called once at finalizer start (the finalizer is added in Step 2.1 at scope top — call it from there only when shutdown is polite, not on the emergency path).

**Verify**: unit test in `dev-session.test.ts`: polite shutdown with a finalizer that sleeps 6s completes without SIGKILL (use fake timers or a shortened budget via env).

### Phase 3 — Remaining display/lifecycle defects

**Step 3.1: Non-interactive log freeze after 100 events (BUG-05).**
`dev-render.ts` non-interactive path: replace `printedLogCount` (array-position based) with a monotonically increasing sequence: give each log entry a `seq` number in `addLog` (state-level counter), keep `printedSeq`, and print entries with `seq > printedSeq`. Cap stays for memory, printing no longer depends on array length.

**Verify**: new test feeding 150 logs through the non-interactive renderer; all 150 lines printed.

**Step 3.2: `--interactive` with non-TTY stdin (BUG-08).**
`dev-render.ts`: wrap `rawCapable.setRawMode?.(true)` in try/catch; on throw (or when `stdin.isTTY` is false while `interactive` was forced), fall back to the non-interactive render path (or exit with a clear error and code 2 if `interactive` came from an explicit flag — pick the fallback, it is strictly more useful).

**Verify**: unit test: `interactive: true` + stdin without `setRawMode`/non-TTY does not throw and renders non-interactively.

**Step 3.3: Post-ready child death shows in the table (BUG-11).**
`orchestrator.ts` exit-watcher post-ready branch: call `callbacks.onStatus(name, "error", describeExit(...))` in addition to the log line — BUT only for unclean exits (use the existing `isCleanSignalExit()`; clean SIGTERM/SIGINT exits during polite shutdown must not flip rows to "failed"). Renderer needs no change ("failed" status already renders).

**Verify**: extend `tests/unit/dev-status-detection.test.ts` or `dev-session.test.ts` with a fake handle exiting unclean after ready.

**Step 3.4: detectStatus false positives (BUG-12).**
`orchestrator.ts` `detectStatus`: evaluate readyPatterns BEFORE errorPatterns, and tighten the ui/host errorPatterns in `service-descriptor.ts` (`/\berror\b(?!s)/i` style word-boundary forms). Add fixtures to `tests/unit/dev-status-detection.test.ts`: "compiled successfully (0 errors)", "ready in 412 ms", "0 failed".

**Verify**: `bun run test -- dev-status-detection` → pass with new fixtures.

**Step 3.5: Spawn errors surface immediately (BUG-14).**
`orchestrator.ts` `exitCode` `onError` callback: also fire `callbacks.onLog(name, \`Spawn failed: ${err.message}\`, true)` and `markError`-equivalent status flip (the exit-watcher fiber that would observe the failure is unobserved — make the error path self-sufficient).

**Verify**: unit test with a descriptor whose `command` is a nonexistent binary; assert an error log + error status within a short window (not the 90s probe deadline).

**Step 3.6: Per-session log filenames (BUG-15).**
`dev-logs.ts`: filename becomes `dev-${ts}-${process.pid}.log`; `dev-latest.log` is updated via rename/copy per session (or a pid-suffixed latest + pointer) so two concurrent sessions in one directory never truncate each other. Check `bos logs` reader (`plugin.ts` logs handler, `cli.ts` rendering) for filename assumptions.

**Verify**: unit test (extend existing dev-logs test if present): two logger instances with different pids write distinct files; `dev-latest.log` points at the newest.

### Phase 4 — Characterization (pins everything above)

Create `tests/unit/dev-session.test.ts` (if not already from Phase 2) covering, with fake processes and `BO_PID_REGISTRY_PATH` pointed at a temp dir (pattern: `tests/unit/process-registry.test.ts`):
1. Startup-window quit kills all spawned-so-far handles (Step 2.1).
2. Polite quit: finalizer order — kills → unregister → flush → unmount → export (Step 1.2 order).
3. Double-signal force exit calls restoreView before any output (Step 1.3).
4. Defect → non-zero exit (Step 2.3).
5. emergencyKill never targets `process.pid` (Step 2.2).

## Test plan

- New: `tests/unit/dev-session.test.ts` (Phase 2/4 cases above — model structure on `tests/unit/process-registry.test.ts` for registry temp-dir isolation and on `tests/unit/dev-render.test.ts` for fake stdin/output).
- Extend: `dev-render.test.ts` — (a) shrinking-frame residue test: render frame A (long summary line), then frame B (shorter), assert every emitted line ends `\x1b[K` and no `\x1b[2J`; (b) post-unmount addLog/updateProcess produce zero output; (c) 150-log non-interactive print (Step 3.1).
- Extend: `dev-status-detection.test.ts` — false-positive fixtures (Step 3.4).
- All existing tests must stay green — especially `spawn-env.test.ts`, `dev-log-pipeline.test.ts`.

## Done criteria

- [ ] `bun typecheck` exits 0; `bun lint` exits 0
- [ ] `cd packages/everything-dev && bun run test` all pass, including new `dev-session.test.ts` and extended renderer/status tests
- [ ] `grep -n "? 0 : 0" packages/everything-dev/src/dev-session.ts` → no matches
- [ ] `grep -n "pid: process.pid" packages/everything-dev/src/orchestrator.ts` → no matches
- [ ] `grep -c "x1b\[K" packages/everything-dev/src/components/dev-render.ts` → ≥ 1
- [ ] Manual smoke (record output in the PR): clean quit via `q`; double Ctrl+C force quit with visible "[Dev] Force exit"; quit during startup leaves zero listeners on the session's ports (`lsof -iTCP -sTCP:LISTEN` before/after); no frame residue when the summary line shrinks
- [ ] Changeset(s) added for user-facing fixes
- [ ] Status row updated in the plans index

## STOP conditions

- The regression stack or CI asserts `bos dev` exit code 0 on failure anywhere (`tests/regression/`, `.github/workflows/`) in a way that can't be updated mechanically — report before changing exit semantics.
- Step 2.1's restructure conflicts with the remote in-process host's `shutdown()` ordering (host teardown hangs when raced) — report; do not special-case blindly.
- Ticket-05's uncommitted changes are no longer on the tree and `DevSessionControls` lacks `requestShutdownEscalating`/`forceExit`/`restoreView` — re-read ticket 05 and re-land its intent first.
- Characterization reveals a teardown ordering dependency this plan breaks twice after a fix attempt.

## Maintenance notes

- Plan 036 Phase 0 characterization should PIN the post-037 behavior (this plan is its prerequisite; 036's Phase 0 list already says so).
- The `l` key remains export-and-quit; the hint text may say "l export+quit" — UX tweak, not semantic.
- Deferred to later plans: display-width-aware clipping (emoji/wide glyphs — needs a wcwidth-style table; keep the `cols-1` margin until then), the four-logging-systems consolidation (architecture cluster, deferred), log-file `drain()` before exit (BUG-10 — S-effort, natural companion when plan 038 touches env/log surfaces; the finalizer now flushes before unmount but async file writes are still fire-and-forget).
- Reviewer focus: Step 2.1's finalizer-at-scope-top is the riskiest change — verify no double-kill (kill idempotence) and that the remote-host path still runs `shutdown()` exactly once.
