# 0051 — Dev plugin adopt: the backend dev loop adopts rebuilt generations without a restart

Date: 2026-11-27

## Context

Issue #942 (stack/2b on the reconciler, #964): a plugin source edit costs a
full stack restart. The pieces exist separately — every-plugin rebuilds the
plugin's `dist`, the dev stack spawns and replaces plugin children (#938's
unit machinery), and the host federation-loads plugin routers in-process at
boot — but nothing connects a rebuild to a serving move. The prior design
round (docs/plans/060, issue #641) already proved the critical fact: the
child process is only the artifact server; host-mediated traffic (`/api`,
`/api/rpc/*`) executes the plugin module the HOST loaded, so restarting
children can never move serving. The only seam that delivers fresh backend
code is in the host.

## Decision

**Two cooperating dev adopters, one shared generation machine — and the
production reconciler stays untouched.** The dev generation identity is the
CONTENT of the built container and manifest (`dist/remoteEntry.js` +
`dist/mf-manifest.json`), not their mtimes: rspack rewrites byte-identical
output on every rebuild, and the supervisor's child replacement runs one more
full build per adopt — an mtime fingerprint would adopt its own no-op rebuild
forever. (ADR 0049's mtime lesson is the UI plane's; backend plugin dists are
the other shape.) A move adopts only after the new content is stable for a
settle window — adopting mid-rebuild would load a half-written generation.

- **Dev supervisor plane** (`packages/everything-dev`, `session.ts`): watches
  the local `api`, `auth`, and `plugin:*` children's built dists; on a move it
  REPLACES the affected child through the spawn machinery and logs one line
  per move — `[dev] plugins/votes moved to generation N`.
- **Host serving plane** (`host`, `dev-plugin-adopt.ts`, armed only in
  `config.env === "development"`): watches the same dists and, on a move,
  reloads the plugin through `PluginRuntime.reloadPlugin` (evict → the MF
  remote purge → fresh load → new instance), then swaps the plugin's serving
  cell (routes layer reads a per-plugin cell per request). In-flight requests
  finish on the old generation; the next request opens on the new one — the
  pair never splits mid-adopt. A failed reload keeps the old generation
  serving and re-owes the move next tick.
- **The adopt set**: plugin children only. The `api` and `auth` app slots
  keep their boot-frozen serving (their routers mount through the api
  handler, the MCP route, and the session middleware — a live swap there
  re-architects the routes layer); `api`/`auth` children are still replaced
  on the supervisor plane, so their standalone surfaces refresh.
- **The MF purge** (`every-plugin`'s `unregisterRemote` +
  `purgeRemoteEntryCache`): the container memoization lives in three
  process-global slots (`CurrentGlobal[entryGlobalName]`, the entry-load
  promise map, the instance's module cache) — only the runtime's own
  `removeRemote` clears them all. No URL buster: the dev dist is served
  fresh at the same URL, so once the slots are purged the next load
  re-fetches new bytes.

The scope-release path is the plugin lifecycle's own: eviction closes the
previous instance's scope, so Layer finalizers release DB pools; the reload
builds the new layer in a fresh scope.

**Plane separation (the reconciler boundary).** The reconciler (#941) moves
boot-frozen pins by INSTANCE replacement, is production-only, and arms via
`BOS_RECONCILE_HELD_GENERATIONS`. The dev adopt is the dev plane's analogue:
it never reads the pendingRestart ledger, never touches published pointers,
and never arms in production. They share only the shape of the idea — a
verified generation replaces the serving one whole.

## Consequences

- The churn arbiter (tests/regression/http/plugin_churn_test.go,
  `BOS_FIXTURE_CHURN=1`) proves the exit criteria: edit a plugin's source,
  the next request serves the new generation with no restart, and every
  response in the window stays coherent (old or new generation, never an
  error or a mix).
- Backend editing is hot again: plugin handler/schema edits reach
  `/api/rpc/<plugin>/*` within seconds of the rebuild landing.
- The `api`/`auth` app slots still need a restart for host-mediated serving
  — the supervisor's child replacement refreshes only their standalone
  surfaces. AGENTS.md's "API edits hot reload" claim is corrected.
- Fingerprint sampling is a stat-memo per workspace (two stats per poll;
  hashing only on a changed stat), so the loop's steady-state cost is noise.
