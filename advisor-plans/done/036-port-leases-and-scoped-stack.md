# Plan 036: Port leases and the scoped stack — block allocation, ownership probes, escalating teardown

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c26e8699e..HEAD -- packages/everything-dev/src/infra/planner.ts packages/everything-dev/src/app.ts packages/everything-dev/src/orchestrator.ts packages/everything-dev/src/dev-session.ts packages/everything-dev/src/process-registry.ts packages/everything-dev/src/plugin.ts packages/everything-dev/src/cli/infra.ts packages/everything-dev/src/service-descriptor.ts`
> Baseline updated 2026-09-23 to `c26e8699e` (after quiet-dev-session tickets 01–03 landed and ticket 05 — TUI quit escalation + viewport-bounded repaint — was committed). Ticket 05's follow-up display/lifecycle fixes land in plan 037, which executes BEFORE this plan's Phase 0; expected drift from 037: `dev-session.ts`, `orchestrator.ts`, `components/dev-render.ts`, `dev-logs.ts`. Any other in-scope change beyond that: treat as a STOP condition.
>
> Read `docs/adr/0012-ports-as-scoped-resources.md` first — this plan implements it.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM (process lifecycle; mitigated by Phase 0 characterization)
- **Depends on**: none hard; lands on top of quiet-dev-session tickets 01–05 (all committed at `c26e8699e`) and **plan 037** (executes first — its Phase 4 characterization pins the fixed quit/teardown behavior this plan's Phase 0 then builds on); the TUI renders the lease table this plan produces
- **Category**: dx
- **Planned at**: commit `84b1b2760`, 2026-09-23

## Why this matters

Ports are the dev workflow's most visible resource and the least disciplined one. Today: silent upward drift that persists to `.bos/infra-state.json` (one foreign process on 3000 permanently repins the stack); a busy port anywhere in the plugin range shifts the whole tail; two allocators with divergent semantics; no ownership identification for busy ports; `bos kill` without escalation or verified release; and no model for concurrent sessions beyond per-port skidding. See the ADR for the full inventory and the seven decisions this plan executes.

## Current state

(Anchors refreshed 2026-09-23 at `add676edc` + ticket 05 working-tree changes.)

- **Planner allocation loop** — `packages/everything-dev/src/infra/planner.ts:78-176` (`allocateServices`): precedence `cliPorts.x ?? persisted?.x ?? DEFAULT` (lines ~81-100, defaults at 36-40); plugin sequential `nextPluginPort + 1` cascade (105-126); auth-mirror exclusion now delegates to the shared `isAuthMirrorPluginEntry` (ticket 03). Persistence write at 436 via `shouldPersistPortState()`.
- **Port state file** — `packages/everything-dev/src/cli/infra.ts:60-116`: `PortState`/`DevPortState` shape, `loadPortState`/`savePortState` → `.bos/infra-state.json` (sync fs).
- **Allocator service** — `packages/everything-dev/src/app.ts:35-43` (`PortAllocator` tag), `PortAllocatorLive` (214-219) seeding `usedPorts` from `claimedPorts()`; bind probe `probePortBindable` (116-147); scan `pickAvailablePort` (149-212). Secondary Effect-native path `prepareDevelopmentRuntimeConfig` (248-345) — used by tests only; the convergence target.
- **PID registry** — `packages/everything-dev/src/process-registry.ts`: `PidEntry` (9-19), atomic write (87-93), `pruneDead` (61-65) / `pruneDeadEffect` (67-85), `claimedPorts()` (137-146). No lease key, no refcount.
- **Session lifecycle** — `packages/everything-dev/src/dev-session.ts`: `STARTUP_ORDER` (34), registration (`registerStandalone` at 114), `updateChildPids` (255), finalizer teardown (256+; kill-all-concurrently → 200ms settle → `view.unmount()` → unregister → flush → optional export), orphan watch (322-335), signal handlers (375-376). Ticket 05: `DevSessionControls` now carries `requestShutdownEscalating`/`forceExit`/`restoreView` — the renderer's `q`/Ctrl+C/`l` path escalates identically to signals (first press polite + 5s force timer, second press forceExit) and `forceExit` restores the terminal before `process.exit`.
- **Orchestrator** — `packages/everything-dev/src/orchestrator.ts`: `ProcessHandle` (28-34), `composeSpawnEnv` (291-324), `spawnDevProcess` (328-526, `detached: true` at 363), per-child kill with escalation (510-522), `emergencyKill` (241-253), spawn modes (606-633). Ticket 03 also added clean-signal-exit classification (SIGTERM/SIGINT exits log as info, ~366-385) — pin this in Phase 0.
- **`bos kill`** — `packages/everything-dev/src/plugin.ts:2100-2162` (file untouched since planning): prune, one SIGTERM/SIGKILL per pid + per childPid (group with direct fallback, 2136-2146), unregister (2120, 2128). **No escalation timer, no verified release.**
- **lsof** — only `tests/regression/lib/kill-stale-ports.mjs:12-22` (`listeningPidsOnPort`, `killPidTree`); nothing in `packages/everything-dev/src`.
- **Test isolation gates** — `packages/everything-dev/src/infra/materializer.ts:179-185` (`shouldPersistPortState`); regression env `tests/regression/lib/regression-env.mjs` (base port 4100, explicit flags, `BOS_NO_PERSIST_PORTS: "1"`).
- **Conventions**: everything-dev src is Effect 4 (`Effect.gen`, `Context.Service`, Layers); CLI output via neighboring helpers; no code comments in implementation.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| everything-dev tests | `cd packages/everything-dev && bun run test` | all pass (baseline count from Phase 0) |
| everything-dev dist | `cd packages/everything-dev && bun run build` | success |
| Regression env tests | `bun run test` (root; regression lib tests included) | exit 0 |
| Two-session smoke | manual, per Phase 4 verification | disjoint blocks, clean teardown |

## Scope

**In scope**:
- `packages/everything-dev/src/infra/port-ownership.ts` (create — lsof ownership probe)
- `packages/everything-dev/src/app.ts` (PortAllocator gains `acquireBlock`; converge `prepareDevelopmentRuntimeConfig` onto it)
- `packages/everything-dev/src/infra/planner.ts` (delete inline allocation loop; block acquisition; persist-only-explicit)
- `packages/everything-dev/src/cli/infra.ts` (persisted state = explicit choices only)
- `packages/everything-dev/src/process-registry.ts` (lease shape, backward-compatible read)
- `packages/everything-dev/src/plugin.ts` (bos kill escalation + verified release — kill handler only)
- `packages/everything-dev/src/orchestrator.ts` (scoped ProcessHandle acquisition/release)
- `packages/everything-dev/src/dev-session.ts` (finalizer wiring, startup adoption of dead-pid-but-held ports)
- `packages/everything-dev/tests/unit/` (characterization + new behavior tests)

**Out of scope**:
- Shared-plugin lease broker across sessions (ADR 0012 §6 — follow-up plan; this plan only makes the registry lease-shaped)
- `--strict-ports` flag (ADR 0012 §4 — deferred until asked for)
- Test-infra changes (`.env.test`, docker-compose, regression gates)
- TUI rendering (tickets 02/03 own `dev-view`)

## Phase 0 — Characterization (protects Phases 1–3)

Create `packages/everything-dev/tests/unit/teardown-characterization.test.ts` pinning CURRENT behavior (post-037 where 037 already landed — these must pass before and after later phases, except where a phase deliberately changes them — mark those tests and flip them in the owning phase):

1. `emergencyKill` group-kills every child pid (SIGKILL to `-pid`, direct fallback) — fake pids.
2. Session finalizer: kill-all-concurrently → 200ms settle → unregister → log flush ordering.
3. Signal handling: first SIGINT requests shutdown, second force-exits; 5s timer fires emergencyKill. Also pin the ticket-03 clean-signal-exit classification (SIGTERM/SIGINT child exits log as info, not `[ERR]`) and the ticket-05 renderer escalation (first `q`/Ctrl+C polite with timer armed, second force-kills; terminal restored on force exit).
4. `bos kill` handler: prune → signal per entry + per childPid → unregister (document the missing escalation as the behavior Phase 1 changes).
5. Registry: `pruneDead` drops dead pids and vanished configDirs; `claimedPorts()` unions live entries' ports.
6. Planner precedence: CLI flag > persisted > default; drift cascade shifts the plugin tail (the behavior Phase 2 changes).
7. Persistence gates: `BOS_NO_PERSIST_PORTS=1`, `BOS_TEST=1`, `NODE_ENV=test` each skip `savePortState`.

Extend `tests/unit/process-registry.test.ts` and `tests/unit/infra.test.ts` where fixtures exist rather than duplicating.

**Verify**: full everything-dev suite passes.

## Phase 1 — Ownership probe + teardown hardening (no allocation semantics change)

1. Create `packages/everything-dev/src/infra/port-ownership.ts`:
   - `ownerOfPort(port): Effect<PortOwner | null>` — `PortOwner = { pid: number; command: string }` via `lsof -ti:<port> -sTCP:LISTEN` + `ps -o command=`; `PortOwner = null` when the port is free or `lsof` is unavailable.
   - Export `isLsofAvailable(): Effect<boolean>` (probed once, cached in the service's Layer).
   - Effect-native (`Effect.callback` around execFile), tagged error type, no shell interpolation of the port beyond an integer check.
2. `bos kill` hardening (`plugin.ts` kill handler):
   - Mirror the session's escalation: SIGTERM to group → 5s wait → SIGKILL group (direct fallback) — reuse/extract the session's timer logic so both paths share one implementation.
   - After signaling, verify release: `probePortBindable` on each claimed port before `unregisterPid`; if still bound after SIGKILL + 250ms, report the surviving port + `ownerOfPort` result and keep the registry entry (fail visibly, not silently).
   - Idempotent: killing an already-dead entry exits cleanly with ESRCH handling (already partly present at 2128 — keep).
3. Verified release in the session finalizer (`dev-session.ts` 263-308): after the kill-all step, probe each owned port; on a still-bound port log the owner info (do not crash shutdown).
4. Startup adoption (`dev-session.ts` bootstrap, before allocation): for registry entries whose pid is dead but whose ports are still listening, `ownerOfPort` each; if the listener pid is a descendant of / equal to the dead entry's childPids, group-kill it and prune the entry. Foreign owners are left alone (Phase 2 reports them).
   - **Amended (plan 042, live orphan incident 2026-09-24)**: adoption must ALSO group-kill any still-alive `childPids` of dead-pid entries even when they hold no ports — rspack/rsbuild watcher grandchildren and any service child that survived a non-graceful orchestrator death hold no registry presence of their own; the dead entry's `childPids` list is the only surviving map of what to reap. (Plan 042 closed the source of these orphans — watcher kill escalation + parent-death supervision in `every-plugin/src/dev/serve.ts` — this amendment reaps the ones that already escaped.)
   - **Acceptance (2026-09-24)**: `tests/regression/framework/adoption_test.go` — `TestHardKillThenBosKillReapsOrphans` (Phase 1 kill escalation + adoption) and `TestNextBootAdoptsOrphans` (Phase 1.4 startup adoption) — must pass with `BOS_TEARDOWN_ADOPTION=1 bun run test:regression:framework`. The suite's two always-on scenarios (`graceful_quit_test.go`, `boskill_test.go`) already pin the 037/042 behavior this plan must not regress.

**Verify**: characterization tests from Phase 0 still pass (kill-handler test flipped to expect escalation + verified release); new unit tests for `port-ownership.ts` (mock lsof binary via injectable command path); `bun lint`, `bun typecheck`.

## Phase 2 — Block allocator + announced drift

1. Extend the `PortAllocator` service (`app.ts`) with `acquireBlock(preferredBase, layout): Effect<BlockAllocation>`:
   - `layout` = the deterministic offsets `{ host: 0, api: +1, auth: +2, ui: +3, pluginsStart: +10 }`; per-service overrides come in as explicit deltas and are honored inside the block.
   - Atomic: probe the whole block (plus per-local-plugin tail needs) before yielding any port; on any conflict, step the entire block (next candidate = base + 100) and retry.
   - Skip blocks claimed by live registry sessions first (lease claims), then bind-probe.
2. `planner.ts` delegates: `allocateServices` becomes layout construction + `acquireBlock`; delete the inline per-port loop, the `nextPluginPort` cascade, and the duplicated defaults. Auth-mirror detection stays (single named helper after ticket 03).
   - **Amended (audit CORRECTNESS-05)**: when deleting `prepareDevelopmentRuntimeConfig` (`app.ts:248-345`), also delete or reconcile the production-dead `materializeLocalDevEnv` (`infra/materializer.ts:103-112`) — it rewrites the entire `.env` destructively and rotates `BETTER_AUTH_SECRET` per render (`cli/infra.ts:405-407`); its test (`materializer.test.ts:117-131`) certifies wrong behavior. Port the remote-host url-patch gate (`app.ts:261-270` gates on `hostIsLocal`; the live planner clobbers remote `host.url` at `planner.ts:449-457`) into the planner, or document the clobber as intentional for `bos start`.
3. Persist-only-explicit (`cli/infra.ts` + planner persistence site): `savePortState` records devPorts only when at least one port flag was explicitly passed; resolved-but-drifted allocations are never written. Bump nothing in the file shape — absent `devPorts` slots mean "not pinned". Also move `savePortState` out of the pre-spawn path (planner.ts:436) so failed runs don't lock in drift (audit CORRECTNESS-07) — persist after the stack reaches ready, or only explicit ports on failure.
4. Announced drift: when the acquired block's base ≠ preferred base, emit a prominent startup notice listing (a) live sibling sessions (registry) and (b) foreign occupants with `ownerOfPort` pid/command. Route through the log pipeline (ticket 01) as `lifecycle`/`warn` so it survives all filters.
5. Lease-shaped registry (`process-registry.ts`): add `leaseKey?: string` (role + configDir + optional pluginId/source) and `refcount?: number` to `PidEntry`; writers populate `leaseKey` for plugin entries; readers treat both fields as optional (backward compatible with existing `pids.json`). No behavioral change yet — this is the broker seam.
   - **Amended (audit BUG-03/CORRECTNESS-04)**: registry hardening must include pid-unique tmp paths (`${path}.${process.pid}.tmp` — the shared `${path}.tmp` interleaves writers), a `try/catch` around `registerStandalone` in dev-session (the only unguarded registry call — a write race kills session B as an unhandled defect), short-timeout lockfile serialization of read-modify-write cycles, and registering the plan's claim right after `planInfra` (the existing `ClaimRecord` machinery is computed but has zero consumers; registration currently happens only after the full bootstrap, leaving build-phase sessions invisible to `bos ps`/`claimedPorts`).
6. Converge `prepareDevelopmentRuntimeConfig` (`app.ts:248-345`) onto `acquireBlock` so the two allocation paths cannot diverge again.

**Verify**: characterization tests 6-7 flipped (no drift cascade; persistence = explicit only); new unit tests: block atomicity (mid-block conflict → whole block moves), sibling-session skip (registry fixture), persist-only-explicit, backward-compatible registry read; `bun run test` green.

## Phase 3 — Layer-ized spawn

1. Wrap `spawnDevProcess` in `Effect.acquireRelease`: acquire = spawn + readiness `Deferred` (current 326-526 body, unchanged spawn flags incl. `detached: true`); release = the existing per-child kill with escalation (510-522).
2. Ports join the same scope: port lease acquire/release becomes an `Effect.acquireRelease` layered under each child's spawn, so scope closure tears down children and ports in dependency order by construction. The session finalizer (Phase 1 verified-release) remains the outermost safety net.
3. Keep the orphan watch and the signal handlers (they drive `requestShutdown`, they are not the release path). Delete any now-redundant imperative cleanup.
4. `emergencyKill` stays as the emergency path only.

**Verify**: all characterization tests pass with the scoped spawn in place; kill one service child manually mid-session and confirm the scope notices (exit watcher) without leaking its port; `bun run test`, `bun lint`, `bun typecheck`.

## Phase 4 — Verification

1. `bun typecheck`, `bun lint`, everything-dev suite, root `bun run test`.
2. `cd packages/everything-dev && bun run build`, then CLI smoke: `node packages/everything-dev/dist/cli.mjs status`.
3. Two-session smoke (manual): start `bos dev` in two different project directories; confirm the second announces block drift (+100) with sibling-session info, both stacks healthy, `bos kill` in each leaves zero listeners (`lsof -iTCP -sTCP:LISTEN` on the used ranges), and neither `.bos/infra-state.json` gained drifted pins.
4. Regression stack still green: `bun run test` includes `tests/regression/lib/regression-env.test.mjs`; run one regression spec if the harness is available.
5. **Docs ride-along (audit DIR-02 — mandatory)**: update `AGENTS.md` (~line 240 "unset flags are auto-picked and persisted", ~line 254 "persisted and reused across restarts" — ADR 0012 §4 reverses both) and `packages/everything-dev/skills/dev-workflow/SKILL.md` port sections (`portBudget`, workspace roles) in the same PR. The skill ships inside the published package (`files: ["dist","skills"]`); without this step the primary agent-facing docs flip from true to wrong on landing.
6. Update the status row in `advisor-plans/README.md` (deviations noted).

## STOP conditions

- Phase 0 characterization reveals behavior this plan's model doesn't account for (e.g. teardown ordering the scope refactor can't preserve).
- `lsof` unavailable or unstable in the environments where tests run and the degraded fallback can't keep tests deterministic.
- Registry backward-compat breaks: an existing `pids.json` entry crashes or is dropped silently.
- Block stepping (+100) collides with the test database port range (5432-5435) or well-known services in practice — report, do not pick a different step unilaterally.

## Related

- ADR 0012 (this plan's decision record)
- Plan 015 (orchestrator characterization tests — Phase 0 implements the subset protecting in-scope files; 015's remaining scope stays TODO)
- Plans 013 (doctor — future home for port-ownership reporting), quiet-dev-session tickets 01–03 (log pipeline + TUI that render this plan's output)
