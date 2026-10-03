# Plan 042: Plugin watcher kill escalation — rspack/rsbuild watchers can never outlive their dev server

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` (after the operator moves this file there from
> `.opencode/plans/`).
>
> **Drift check (run first)**: `git diff --stat baf470d02..HEAD -- packages/every-plugin/src/dev/serve.ts packages/every-plugin/tests/`
> Any in-scope change: compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P1 (live incident class — processes that survive every teardown path)
- **Effort**: S
- **Risk**: LOW (adds escalation to an existing kill path; the happy path is unchanged)
- **Depends on**: none (independent of 036/037; land in any order)
- **Category**: bug
- **Planned at**: commit `baf470d02`, 2026-09-23

## Why this matters

Live evidence: 15 orphaned `rspack build --watch` processes (PPID 1, three dead sessions × their plugin watchers) survived every teardown mechanism the platform has — graceful session quit, `bos kill`, `bos kill --all` — because they are invisible to the PID registry (only top-level `bun run dev` children are registered) and because nothing ever sends them a SIGKILL. The plugin dev server's own shutdown sends a bare SIGTERM to its watchers and then force-exits itself after 3 seconds; `rspack build --watch` ignores/mishandles SIGTERM, so the watcher outlives its parent, reparents to PID 1, and squats CPU + file watches forever. This plan makes the watcher kill escalate to SIGKILL and adds parent-death supervision, so a watcher can never outlive its dev server regardless of which teardown path fires.

## Current state

- **`packages/every-plugin/src/dev/serve.ts`** — the plugin dev server (plain TS, not Effect — match its style; no code comments per repo convention):
  - Watcher spawns: `rspack build --watch` at 164-176 and `rsbuild dev` at 206-214 — plain `spawn(...)` with `stdio: "inherit"`, no `detached` (they share the dev server's process group), no exit supervision.
  - `close()` at 437-451: for each of `[watcher, uiWatcher]` — `if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM")` — **SIGTERM only, no wait, no escalation**; then closes servers/runtime.
  - Signal handlers at 453-462: `process.once("SIGINT"/"SIGTERM", async () => { const timeout = setTimeout(() => process.exit(0), 3000); await close(); clearTimeout(timeout); process.exit(0); })` — the 3s timer exits the dev server even if the watchers ignored the signal.
- **Orchestrator side (context only, out of scope here)**: the session finalizer's per-child kill DOES escalate (SIGTERM group → 3s → SIGKILL group, `packages/everything-dev/src/orchestrator.ts:510-522`), but only runs on graceful quit; `bos kill` has no escalation (plan 036 Phase 1 fixes that); registry adoption of unregistered grandchildren doesn't exist (plan 036 Phase 1.4 amendment below).
- **Tests**: `packages/every-plugin/tests/unit/` exists (vitest); a supervision helper must be extracted to be testable.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| every-plugin tests | `cd packages/every-plugin && bun run test` | all pass |
| every-plugin build | `cd packages/every-plugin && bun run build` | success |
| Watcher smoke | manual (below) | no surviving rspack/rsbuild process |

## Scope

**In scope**:
- `packages/every-plugin/src/dev/serve.ts`
- `packages/every-plugin/src/dev/watch-kill.ts` (create — the escalation + supervision helper)
- `packages/every-plugin/tests/unit/watch-kill.test.ts` (create)

**Out of scope**:
- `packages/everything-dev` (orchestrator/`bos kill` escalation — plan 036 Phase 1)
- The plugin dev server's HTTP/RPC lifecycle (already correct)
- rspack/rsbuild themselves (vendored CLIs — work around their SIGTERM behavior)

## Steps

### Step 1: Extract an escalating child-kill helper

Create `packages/every-plugin/src/dev/watch-kill.ts`:

```ts
export const killChildEscalating = async (
  child: { pid?: number | undefined; kill: (signal?: NodeJS.Signals) => void; exitCode: number | null; killed: boolean },
  terminateMs = 2000,
): Promise<void> => {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  const exited = await waitForExit(child, terminateMs);
  if (!exited) child.kill("SIGKILL");
};
```

`waitForExit` attaches a one-shot `exit` listener with a timeout race (plain Promise, matching serve.ts style; `pid === undefined` means the spawn never happened — treat as exited). Export both for testing.

**Verify**: `bun typecheck` (new file compiles).

### Step 2: Use it in close() + kill before force-exit

In `serve.ts` `close()` (437-451): replace the bare SIGTERM loop with `await killChildEscalating(watcher)` / `await killChildEscalating(uiWatcher)` (guard null as today). In both signal handlers (453-462): the existing 3s `setTimeout(() => process.exit(0))` stays as the final backstop, but `close()` now escalates within its own 2s budget — total worst case ~2s (kill escalation) inside the 3s backstop. If `close()` rejects, the backstop still exits (current behavior — preserve it: wrap the `await close()` in the same try/catch absence as today; the timer is the guarantee).

**Verify**: `cd packages/every-plugin && bun run test` → pass.

### Step 3: Parent-death supervision (covers wrapper SIGKILL)

In `serve.ts`, after the watcher spawns: poll `process.ppid` every 200ms (`setInterval`, `unref()`); if it changes (wrapper died — e.g. terminal/playwright tree-kill), run `close()` (now escalating) and `process.exit(0)`. This mirrors the orchestrator's orphan watch (`packages/everything-dev/src/dev-session.ts:322-335` — same pattern, same rationale). Extract the polling into `watch-kill.ts` as `watchParentDeath(onParentDeath, opts?: { intervalMs?: number; getPpid?: () => number })` so it is unit-testable with an injected `getPpid`.

**Verify**: `bun run test -- watch-kill` → new tests pass.

### Step 4: Manual watcher smoke

In a scratch plugin project (or this repo's `plugins/_template`): `BOS_UI_PORT=4099 bun run dev`, wait for the rspack watcher to start, then `kill -9` the dev server's parent chain (simulate wrapper death): confirm the watcher dies within ~1s (ppid supervision) — then repeat with plain SIGTERM to the dev server and confirm escalation (watcher dead, no PPID-1 survivor): `pgrep -f "rspack build --watch"` → no matches from the test project.

## Test plan

Create `packages/every-plugin/tests/unit/watch-kill.test.ts`:
1. `killChildEscalating`: fake child that ignores SIGTERM (exit listener never fires within timeout — use a short `terminateMs`) → SIGKILL sent. Assert `kill` call sequence `["SIGTERM", "SIGKILL"]`.
2. Fake child that exits on SIGTERM → only `["SIGTERM"]`, resolves fast.
3. Already-exited child → no kill calls.
4. `watchParentDeath` with injected `getPpid`: first poll same pid → no callback; ppid changes → callback fires once, interval cleared.
Model on neighboring every-plugin unit tests (see `packages/every-plugin/tests/unit/` for style).

## Done criteria

- [ ] `bun typecheck`, `bun lint` exit 0; every-plugin tests pass with the new `watch-kill.test.ts`
- [ ] `grep -n 'child.kill("SIGTERM")' packages/every-plugin/src/dev/serve.ts` → no bare-SIGTERM watcher kills remain (the escalation helper is used)
- [ ] Manual smoke: no `rspack build --watch` / `rsbuild dev` process survives its dev server by either SIGTERM or SIGKILL of the parent chain
- [ ] Changeset added (user-facing: orphaned build watchers)
- [ ] Status row updated in the plans index

## STOP conditions

- The 2s escalation inside `close()` makes the signal-handler path exceed its 3s backstop in practice (hangs instead of exiting) — lower `terminateMs` or kill synchronously; report if the backstop model is insufficient.
- `rsbuild dev` depends on receiving SIGTERM for a clean rebuild-cache flush and SIGKILL corrupts its cache on every shutdown — verify in the smoke; if corrupted, keep SIGKILL only on the supervision path (parent death), not the polite path.
- every-plugin's dev serve is consumed through a path that doesn't run the signal handlers (embedded/programmatic use) — report the caller before adding the supervision there.

## Amendment to plan 036 (for the 036 executor / operator — apply to `advisor-plans/036-port-leases-and-scoped-stack.md`, Phase 1 item 4)

Extend startup adoption beyond port holders: **for registry entries whose pid is dead, group-kill any still-alive `childPids`** (they are orphaned or reparented service trees of ours), not only entries whose ports are still listening. Rationale from the 2026-09-23 live incident: rspack/rsbuild watcher grandchildren (plan 042) and any service child that survived a non-graceful orchestrator death hold no registry presence of their own; the dead entry's `childPids` list is the only surviving map of what to reap. Foreign-owned pids are left alone, as the plan already specifies. (Operator note: registry file hygiene — pruning dead entries from the file on read — was considered and not selected in this session; do not add it.)

## Immediate operator cleanup (not part of any plan — run once)

```bash
pkill -f 'citynode\.app\.v1\.passkey-sync.*rspack'   # the 15 PPID-1 watcher orphans
bos kill                                              # in this repo's dir — flushes the dead pid 95054 entry (ESRCH → unregister)
```

## Maintenance notes

- Plan 036 Phase 1's `bos kill` escalation (SIGTERM → 5s → SIGKILL groups) is the OTHER half of this fix — it covers group members that ignore SIGTERM when the orchestrator itself is being killed. 042 (self-exit path) + 036 Phase 1 (external kill path) + 036 Phase 1.4 amendment (adoption on next boot) together close the class.
- The orchestrator's own finalizer already escalates per-child (orchestrator.ts:510-522) — do not duplicate that here.
- Reviewer focus: the `rsbuild dev` cache-flush STOP condition — the polite path should prefer SIGTERM-then-wait and only escalate when the wait fails.
