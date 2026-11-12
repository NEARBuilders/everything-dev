# Plan 060: Host-side dev reload — editing backend code re-loads the running host without a stack restart

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `docs/plans/README.md` unless the dispatching reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 1e435601..HEAD -- host/src/services/plugins.ts host/src/services/snapshot-watch.ts packages/every-plugin/src/runtime/index.ts packages/every-plugin/src/remote-entry.ts packages/everything-dev/src/services/dev/orchestrator.ts packages/everything-dev/src/services/dev/session.ts packages/every-plugin/src/dev/serve.ts`
> On any mismatch, compare the "Current state" excerpts against the live code before proceeding; on a conflict, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH (Effect layer teardown of scoped DB resources; MF runtime cache manipulation)
- **Depends on**: 059 (timing instrumentation proves the win and measures it)
- **Category**: dx / perf
- **Planned at**: commit `1e435601`, 2026-10-28
- **Issue**: https://github.com/NEARBuilders/everything-dev/issues/641

## Why this matters

Editing any backend file (`api/src/`, `plugins/*/src/`) today costs a full stack restart: `rspack build --watch` faithfully rebuilds the plugin's `dist/remoteEntry.js`, but nothing re-imports it — the dev serve loaded its plugin once (`void load()` at `serve.ts:311`, never again), and the host loaded the same plugin into its own process at boot. The result is the single largest "app dev is slow" cost, and AGENTS.md's claim that `api/src` edits "hot reload automatically" is false (doc drift — fix the doc in this plan).

**A prior design (restart the dev serve) was rejected during verification, and this plan is built on why:** the host loads each plugin's `remoteEntry.js` from the dev serve's HTTP server **into the host process** (`host/src/services/plugins.ts:456-460`), and the MF runtime memoizes resolved entries process-globally. Restarting the dev serve refreshes only the serve's own RPC port — every request through the host (`:3000/api/...`, SSR) still executes the old in-process code. The only seam that delivers fresh backend code to host-mediated traffic is **in the host**: purge the entry cache, evict the host's plugin cache, re-load. That is this plan. A `bos restart <service>` command is included as a complement (and as the escape hatch), with its limits stated honestly.

## Current state

- **The host's load path** — `host/src/services/plugins.ts:425-460` (region): each plugin entry is MF-loaded via `loadPluginEntryEffect` → `usePlugin` on the host's runtime; the loader is `loadRemoteWithRetry` (`:457`) which uses `every-plugin/src/remote-entry.ts`'s retry/poll (120 s budget, 300 ms poll). Routers are composed once at `PluginsService.Live` layer construction (`host/src/services/plugins.ts:777-797`) — a `Layer.effect` built during host boot; nothing rebuilds it afterwards.
- **The memoization** — `packages/every-plugin/src/remote-entry.ts:1-41`: entries resolve through `globalThis.__GLOBAL_LOADING_REMOTE_ENTRY__` (runtime-core never evicts rejections); the purge helper exists and is deliberately failure-path-only:

```ts
// remote-entry.ts:28-41 — "Deleting a RESOLVED entry would force a wasteful
// re-eval, so only call this from failure paths."
export const purgeRemoteEntryCache = (remoteUrl: string): void => {
  const globalLoading = (globalThis as Record<string, unknown>).__GLOBAL_LOADING_REMOTE_ENTRY__ as
    | Record<string, unknown>
    | undefined;
  if (!globalLoading) return;
  for (const key of Object.keys(globalLoading)) {
    if (key.endsWith(`:${remoteUrl}`)) delete globalLoading[key];
  }
};
```

  A dev reload is a sanctioned NEW caller of this: it intentionally forces re-eval.
- **The host-side plugin cache** — `packages/every-plugin/src/runtime/index.ts:140-206`: `pluginCache`/`routerCache` are Maps keyed by a config-derived `cacheKey` (`generateCacheKey(pluginId, {...config, __plugins})`); `usePlugin` returns the cached promise on hit (`:147-164`); failures evict (`:169-175`); `evictPlugin(pluginId, config, plugins)` exists (`:184` calls it; defined at `:257-270` per the module's own API) — reload can build on it rather than inventing eviction.
- **The only existing watch fiber is production-only** — `host/src/services/snapshot-watch.ts:321-331`:

```ts
// snapshot-watch.ts:321-324
if (config.env !== "production") {
  logger.info("[SnapshotWatch] disabled outside production (boot config is the truth in dev)");
  return SnapshotWatch.of({ tick, /* … */ });
}
```

- **No restart command exists** — `grep -rn "restart" packages/everything-dev/src/cli packages/everything-dev/src/services/dev` → zero hits; the interactive renderer handles only `l` and `q` (`cli/render/dev-render.ts:435-440`). The orchestrator is the sole supervisor and does not respawn: its exit-watcher (`orchestrator.ts:578-604`) only flips status to error; PIDs are written once (`session.ts:448-460`). Per-service kill primitives exist on `ProcessHandle` (SIGTERM → escalate, `orchestrator.ts:680-692`).
- **What initialize costs** — plugin `initialize` returns an Effect `Layer` built against the plugin's lifecycle scope (DB pools, caches; e.g. `api/src/db/layer.ts` → `databaseLayer` from `everything-dev/db`). A reload that re-runs initialize MUST release the old scope or leak pools/connections.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0 |
| Framework tests | `pnpm run test:framework` | all pass |
| Host tests | `pnpm --filter host test` | all pass |
| Dev boot (baseline) | `pnpm run dev` | stack up; timings printed (per plan 059) |
| Regression | `pnpm run test:regression:dev:ssr` (after `pnpm run test:db:up`) | green |

## Scope

**In scope** (the only files you should modify):
- `host/src/services/dev-reload.ts` (create — the dev-only watch fiber)
- `host/src/services/plugins.ts` (expose a re-load entry point used by the watch; keep production path byte-identical)
- `host/src/program.ts` (wire the watch in dev env only)
- `packages/every-plugin/src/runtime/index.ts` (eviction helper refinement if the existing `evictPlugin` doesn't cover the host's key shape — prefer reusing it as-is)
- `packages/every-plugin/src/remote-entry.ts` (no code change expected; possibly export a targeted purge-by-entry-URL variant)
- `packages/everything-dev/src/services/dev/orchestrator.ts` + `session.ts` + `cli/render/dev-render.ts` (Phase B: `bos restart <service>` via renderer key / IPC — see Step 3)
- `AGENTS.md` (one line: backend edits reload via the host dev watch; `bos restart <service>` for full-service restarts)
- test files for the above

**Out of scope** (do NOT touch):
- Production load/watch behavior (`snapshot-watch.ts` production fiber, deploy pins, SRI verification) — the watch must be a no-op outside development.
- The dev serves' own `void load()` (Phase 2 of an older idea) — with the host watch in place it is redundant for iteration; leave it.
- UI/rsbuild HMR — already works on the CSR path.
- Plan 062's single-runtime dev re-architecture — this plan must be compatible with it (the watch keys on locally-resolved slots, whatever process serves them).

## Git workflow

- Branch: `feat/host-dev-reload-watch`
- Commit style: conventional commits, e.g. `feat(dev): host-side reload watch for locally-resolved plugin slots`

## Steps

### Step 1: characterization — prove the gap, then build on it

Before writing the watch, write a failing-intent test that pins today's behavior: a host-process-level test (vitest, `pnpm --filter host test` conventions; the workspace script pins `NODE_ENV=production`) asserting that after `purgeRemoteEntryCache(url)` + runtime eviction + a re-load, a changed `remoteEntry.js` is actually re-fetched and re-initialized. If a fixture harness for host plugin loading already exists (look in `host/src/__tests__/` or similar), extend it; otherwise this becomes part of Step 2's implementation tests. Do not skip this step: the purge target is a process-global whose shape mocks cannot pin (the audit's E9 finding) — the test must exercise the REAL installed `@module-federation/runtime-core`.

**Verify**: the characterization test fails before the fix, passes after Step 2.

### Step 2: implement the dev reload watch

Create `host/src/services/dev-reload.ts`:

1. In dev env only (`config.env !== "production"`), watch the `dist` directories of **locally-resolved plugin slots** (slots whose entry URL is localhost — derive from the same slot resolution the host loader already did at boot; do NOT re-resolve remote/pinned slots).
2. On mtime change of a watched `remoteEntry.js` (poll with ~500 ms interval or `fs.watch` — prefer polling; `fs.watch` on macOS emits rename storms): run the reload sequence **per plugin**:
   a. `purgeRemoteEntryCache(<entryUrl>)` (the new sanctioned caller),
   b. evict the host runtime's cache entry for that plugin (reuse `evictPlugin` with the SAME `pluginId/config/plugins` args the host used at boot — capture them at load time),
   c. re-run the plugin load+initialize through the existing `loadPluginEntryEffect` path so the new `initialize` layer builds,
   d. rebuild the router and swap it into whatever structure `PluginsService.Live` handed out (inspect how routers are stored at `plugins.ts:777-797` and update in place; if routers are baked into an immutable layer value, introduce a mutable indirection — a single `ref` the oRPC composition reads — smallest seam that keeps production byte-identical),
   e. release the OLD plugin scope: the plugin's `initialize` layer was built against a lifecycle scope — run the reload inside a fresh Effect scope and close the previous one (Layer finalizers tear down DB pools). **This is the HIGH-risk step**: if scoped-resource release misbehaves (open connections, half-torn pools), STOP per the escape hatch.
3. Serialize reloads per plugin (debounce 250 ms; queue at most one pending reload — collapse rapid successive saves).
4. Log one line per reload: `[dev-reload] api reloaded (router rebuilt, prior scope released)` — and on failure, the named error with the plugin key.

**Verify**: `pnpm run typecheck && pnpm --filter host test` → green. Manual: `pnpm run dev`; edit a string in `plugins/votes/src/...` handler; save; within ~5 s the host log shows the reload line; a request through the host port reflects the edit (curl the votes route or check the UI). Old DB pool released: watch Postgres connection count (`SELECT count(*) FROM pg_stat_activity;`) stays flat across repeated reloads of the same plugin.

### Step 3: `bos restart <service>` (complement + escape hatch)

Add a per-service restart to the dev session (renderer key `r <service>` and/or a CLI subcommand reading the session registry): kill the service's `ProcessHandle`, await port release, respawn it via the existing descriptor machinery, re-encode `BOS_RUNTIME_CONFIG` (orchestrator.ts:484 pattern), re-register the child PID in the session registry. **Document in the command's help text**: restarting a *dev serve* refreshes only that serve's own port — host-mediated traffic keeps the host's in-process copy; use the host watch (automatic) or `bos restart host` for that. If in-session triggering from the CLI process proves to need an IPC seam the orchestrator doesn't have, implement the renderer-key path only and note the CLI variant as deferred — do not invent a new daemon.

**Verify**: `pnpm run dev` → press the restart key for `votes`: the service respawns, ports unchanged, session stays up; `bos ps` shows a fresh PID. Unit tests for the respawn path follow the existing orchestrator test harness.

### Step 4: doc truth

Update AGENTS.md's "Making Changes" bullet that claims `api/src` edits hot-reload automatically: state the actual mechanism (host dev watch reloads backend plugins automatically; UI has HMR; `bos restart <service>` exists for full-service restarts).

**Verify**: `grep -n "hot reload automatically" AGENTS.md` → no longer present (or reworded accurately).

### Step 5: gates

**Verify**: `pnpm run typecheck && pnpm run lint && pnpm run test:framework && pnpm --filter host test && pnpm run test:regression:dev:ssr` → all green.

## Test plan

- Characterization + behavior test against the real runtime-core (Step 1): failed-then-purged entry actually re-loads; purged-but-never-loaded entry is a no-op; purge of an unrelated URL doesn't evict others (the `key.endsWith(":url")` contract at `remote-entry.ts:38-40`).
- Unit: reload serialization/debounce (rapid saves → one reload); scope release (fake plugin whose initialize layer registers a finalizer — assert it runs on reload); dev-only gating (production env → watch never installed).
- `bos restart`: respawn preserves ports and session registry (extend the orchestrator's process-death harness tests).
- Structural pattern: `packages/everything-dev/src/services/dev/` existing tests (process-death harness from #631) and `remote-entry-readiness.test.ts` (real-runtime fixture pattern).
- Verification: all suites listed in Done criteria.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Editing a plugin handler in a running `pnpm run dev` session is visible through the host port within ~5 s without restarting anything (manual check documented in the PR)
- [ ] Postgres connection count flat across ≥3 consecutive reloads of the same plugin (no pool leak)
- [ ] `bos restart <service>` respawns one service; `bos ps` shows the new PID; session survives
- [ ] In production (`config.env === "production"`) the watch is not installed (unit test + grep of the gating condition)
- [ ] All suites green: `pnpm run typecheck && pnpm run lint && pnpm run test:framework && pnpm --filter host test && pnpm run test:regression:dev:ssr`
- [ ] AGENTS.md backend-reload claim matches reality
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The reload sequence cannot release the previous plugin scope cleanly (DB connections accumulate, finalizers don't run) after one genuine fix attempt — this is the known HIGH-risk area; report the leak signature rather than shipping a pool leak.
- The MF entry cache purge proves insufficient for re-eval in the real runtime-core (e.g. a second memoization layer beyond `__GLOBAL_LOADING_REMOTE_ENTRY__`) — report what still serves the old module.
- Swapping the rebuilt router requires re-architecting `PluginsService.Live` beyond a single mutable indirection.
- Reload of the `api` plugin specifically breaks `pluginsClient` composition (the api's cross-plugin client map was built with the OLD siblings) — the fix may require reloading dependents after dependencies; design that increment with the reviewer before proceeding.
- Regression suites (dev:ssr/dev:csr) fail on reload-induced nondeterminism.

## Maintenance notes

- `purgeRemoteEntryCache` gains its first non-failure caller — update its doc comment ("only call from failure paths") to "failure paths and the dev reload watch".
- If plan 062 (single-runtime dev) lands, this watch's slot discovery must follow whatever serves the dists then; keep the watch keyed on slot entry URLs, not process topology.
- Reviewer scrutiny: (1) the scope-release path (pool leaks); (2) that production gating is structural (watch never constructed), not a runtime check inside the tick; (3) the `as any` count in the new file — the audit flagged MF-internals `as any` clusters as silent-degradation risks (federation/service.ts has 14); keep the new file's casts centralized with a loud warning when the expected globals/hooks are absent.
- Deferred: reloading the dev serve's own router (redundant with the host watch); SSR module-cache dev bypass (PERF-07 from the 2026-10 audit — related but separate: `host/src/services/federation.server.ts:28` 5-minute expose TTL; file as follow-up if dev SSR staleness bites).
