# ADR 0012: The dev stack is one Effect Scope — ports and processes are scoped, leased resources

Date: 2026-09-23
Status: Accepted (amended 2026-09-26 — claim identity + start-stack allocation)

## Context

The dev-session port story produces recurring unexpected behavior:

- **Sticky silent drift.** Port resolution (`packages/everything-dev/src/infra/planner.ts:63-176`, precedence CLI flag → persisted `.bos/infra-state.json` → defaults 3000/3001/3002/3003/3010) scans upward per-port on conflict (`packages/everything-dev/src/app.ts:149-212`) and persists the drift (`planner.ts:444-452`). One foreign process on 3000 permanently repins the stack to 3005+, and a single busy port inside the plugin range shifts the entire tail (`nextPluginPort = port + 1` cascade, `planner.ts:91-122`).
- **Two allocators.** `planInfra` (used by `bos dev`) and the Effect-native `prepareDevelopmentRuntimeConfig` (`app.ts:248-345`, reserved for the workspace-orchestrator future) implement allocation twice with divergent semantics.
- **No ownership probe.** The PID registry knows our own sessions, but nothing identifies *who* holds a busy port — no `lsof` anywhere in the CLI. The regression harness preemptively lsof-kills the whole port range before every boot (`tests/regression/lib/kill-stale-ports.mjs`) because stale squatters were a recurring failure.
- **Asymmetric teardown.** The dev session escalates SIGTERM → 5s → SIGKILL with an orphan watch (`dev-session.ts:241-370`), but `bos kill` (`plugin.ts:2115-2146`) sends one signal with no escalation, and every release is fire-and-forget — nothing confirms a port actually freed.
- **No multi-session model.** Two concurrent `bos dev` apps each spawn their own copy of every local plugin on their own ports; there is no sharing model.

URL derivation is *not* the problem: the port informs the URL (`BASE_URL`/`CORS_ORIGIN` from the resolved host port, `planner.ts:386-408`), and that direction stays.

## Decision

1. **One allocator.** `planInfra` delegates to the Effect-native `PortAllocator` service (`Context.Service` + Layer); the planner's inline allocation loop is deleted.
2. **Ports are scoped resources.** Acquire = bind-probe + registry lease claim. Release = escalating group-kill → *verified* bindable → unregister. Both live in the dev session's Effect `Scope` finalizers, so a port can never outlive its owner.
3. **Block layout from one base port.** `bos dev --port N` deterministically derives the full layout (host N, api N+1, auth N+2, ui N+3, plugins N+10…); the per-service flags remain explicit overrides. A block is validated and acquired atomically — never a half-shifted layout or a half-started stack.
4. **Announced block drift, never persisted.** If the preferred block is occupied: registry-known live sibling sessions are skipped deterministically via their lease claims; foreign occupants are identified (`lsof` → pid, command) and reported in a prominent notice; the session then takes the next block (+100 step). Drift is never persisted — only explicitly-passed port flags are. A future `--strict-ports` escape hatch (not built now) can turn foreign occupancy into a hard error.
5. **Escalating teardown everywhere.** `bos kill` mirrors the session's SIGTERM → 5s → SIGKILL group-kill; every release verifies the port is bindable before unregistering; startup adopts-or-kills registry entries whose pid is dead but whose ports are still held (reparented grandchildren).
6. **Lease-shaped registry; shared-plugin broker deferred.** Registry entries gain a lease key (role, configDir, pluginId+source) and a refcount-ready shape. Concurrent sessions get disjoint blocks and duplicate plugin processes *today*; a cross-session shared-plugin lease broker (refcounted plugin processes keyed by `(pluginId, localPath|remoteUrl)`) is a follow-up plan that this registry shape enables without migration.
7. **Test isolation unchanged.** `BOS_NO_PERSIST_PORTS` / `BOS_TEST` / `NODE_ENV=test` gates (`infra/materializer.ts:179-185`), `.env.test` DB ports, and the regression fail-fast guards stay exactly as they are.

## Consequences

- Restarts always re-try the preferred base; concurrent sessions stack in 100-port blocks with zero configuration.
- `BASE_URL`/`CORS_ORIGIN` derivation is unchanged but now inherits a drift-proof layout by construction.
- `bos kill` becomes idempotent and safe to call twice; the regression harness's kill-sweep becomes belt-and-braces rather than load-bearing.
- `lsof` becomes a dev-machine dependency for ownership reporting (absent `lsof`: allocation still works via bind-probe, reporting degrades to "unknown owner").
- The TUI (quiet-dev-session tickets 02/03) renders the lease table: one block per session, with ownership annotations available.
- Child-process spawn becomes a scoped resource (`Effect.acquireRelease` around the existing `ProcessHandle`); the session finalizers remain the single teardown path, and the orphan watch stays.

## Amendment (2026-09-26): claim identity, listener authority, start-stack allocation

The deployment runtime (ADR 0009 amendment) exposed two holes in decisions 4–5
when a container restarts (`docker restart` preserves the writable layer and
therefore the registry at `~/.cache/everything-dev/pids.json`):

1. **Claims record the process generation.** Container PID spaces are tiny, so
   a dead session's recorded PID is near-certainly reused by an unrelated
   process after a restart — `process.kill(pid, 0)` succeeds and a stale claim
   looks live. Registry entries now capture `processStart` at registration
   (`processStartTime`: `/proc/<pid>/stat` starttime tick on Linux,
   `ps -o lstart=` elsewhere); a claim whose recorded generation no longer
   matches the live process is pruned (ADR 0012 §5's adopt-or-kill could
   misfire on exactly this). Entries written before this field exist keep the
   old alive-pid gate (legacy tolerance).
2. **A listener is the authority for a pinned port.** Decision 4's
   "explicitly-passed flags fail loudly" now verifies an actual socket before
   failing: a pinned port blocked only by a pruned-away (stale) claim is
   reclaimed and the allocation proceeds; a real listener fails the
   allocation with the holder identity in the error. Claims alone never wedge
   a pinned port — that turned a healthcheck restart into a permanent 502
   crash loop.
3. **Remote-source services allocate no ports.** In the start stack every
   remote except the host loads over MF from its published origin and spawns
   nothing locally — allocating its block entry only created conflicts with
   the entrypoint's own static servers. The host is the exception: even when
   loaded as a remote module, `runServer` binds its own port, so its entry
   (pinned by `--port`) is always allocated.
4. **Healthcheck start-periods cover cold boot.** A Docker/Railway
   `HEALTHCHECK` whose start-period is shorter than the entrypoint's own boot
   deadline restarts a healthy-in-progress boot mid-startup — feeding the
   same crash loop. Start-periods are now sized above the worst-case cold
   boot (120s/180s), above the entrypoint's 180s deadline.
