# Plan 062: Single-runtime dev — design doc: the host becomes the only plugin runtime in `bos dev`

> **Executor instructions**: This is a **design-first plan**: the deliverable is a decision document plus an implementation plan skeleton — NOT production code. Follow the steps, run the verification commands, and write the design doc where specified. Honor STOP conditions. When done, update the status row for this plan in `docs/plans/README.md` unless the dispatching reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 1e435601..HEAD -- packages/everything-dev/src/services/dev/ packages/every-plugin/src/dev/ host/src/services/plugins.ts`
> On any mismatch, re-read the touched files before proceeding; on a conflict with the facts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (design) — the follow-up implementation plan it produces is L
- **Risk**: LOW (design only)
- **Depends on**: 059 (timings — the success criteria are measured with them), 060 (host reload watch — the eviction seam this design reuses)
- **Category**: direction / tech-debt (design)
- **Planned at**: commit `1e435601`, 2026-10-28
- **Issue**: https://github.com/NEARBuilders/everything-dev/issues/643

## Why this matters

Today `bos dev` boots ~28 node processes: 1 orchestrator, 1 host, 8 dev serves (each: pnpm → every-plugin bin wrapper → tsx serve), 8 bin wrappers, 7 rspack watchers, 3 rsbuild dev servers — and the audit found every plugin is **initialized twice** (dev serve self-load + host in-process load = 2× DB pools + 2× migrate-on-boot per plugin), while the host is the only runtime whose code actually serves host-mediated traffic (plan 060's central discovery). The dev serves are a second, largely redundant runtime. The "single-runtime dev" design collapses them to thin static+health shells (or removes them), cutting the fleet to roughly ~12 processes, eliminating the double-init cost, and shrinking the reload problem to the single cache seam plan 060 already built. The interface stays `bos dev` — this is a deepening: same interface, drastically smaller implementation surface.

## Current state (facts the design must respect)

- **Double initialization** — each dev serve self-loads its plugin via MF after its build (`packages/every-plugin/src/dev/serve.ts:264-270` self-load with `loadPluginWithRetry`, 90 s timeout at `:78`; `serve.ts:311` `void load()` once) while the host loads the same plugin in-process (`host/src/services/plugins.ts:456-460`). With DB-backed plugins, both run `initialize` (pool + migrate-on-boot).
- **The dev serve's HTTP surface** — `packages/every-plugin/src/dev/serve.ts` + `dev/host.ts` (~650 LOC total): CORS/health/RPC(`/api/rpc`)/OpenAPI/static file serving + plugin-UI static serving (rsbuild dev server for ui remotes). Sibling plugin loading for `pluginsClient` composition in the serve (`serve.ts:239-262`).
- **What the host actually consumes from dev serves** — the host MF-loads each plugin's `remoteEntry.js` over HTTP from the dev serve (`host/src/services/plugins.ts:456`; dev slots resolve to `<dev-serve-base>/remoteEntry.js` per `packages/everything-dev/src/ui/slot.ts`), and proxies `/api/rpc/...` to itself (in-process composed routers), not to the serves.
- **Spawn chain** — descriptors spawn `pnpm run dev` per service (`services/dev/service-descriptor.ts:88-128,240-261`); `packages/every-plugin/bin/every-plugin.mjs:16-27` re-executes itself via `spawnSync(node --import tsx ...)` leaving an idle wrapper parent; readiness via HTTP probe + stdout patterns (`orchestrator.ts:95-111`), `PLUGIN_READY_PATTERNS` includes `/listening/i` (`service-descriptor.ts:79`).
- **Existing plans this builds on** — 059 (timings), 060 (host watch + `evictPlugin`/`purgeRemoteEntryCache` seam), and the audit's D5/D6 findings (double init; process count). Plan 017's `everything-dev/db` runtime is shared by both copies today — irrelevant once one copy remains.
- **ADR context** — ADR 0012 (ports as scoped resources; per-plugin ports exist and are pinned per explicit flags), ADR 0004 (dev serve entry resolution). The design must state which port contract survives.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0 |
| Baseline timings (from 059) | `pnpm run dev` | timings block printed; record as the BEFORE numbers |

## Scope

**In scope** (the only files you should create/modify):
- `docs/plans/v1-current/single-runtime-dev-design.md` (create — the design doc deliverable)
- `docs/plans/README.md` (status row)

**Out of scope**:
- Any production code change (implementation follows in a successor plan after the design is ratified).
- `docs/plans/prototypes/` — if the design needs a runnable probe, scope it in the doc; prototypes are TS5-pinned and exempt from repo TS rules (per AGENTS.md).

## Git workflow

- Branch: `feat/single-runtime-dev-design`
- Commit style: conventional commits, e.g. `docs(plans): single-runtime dev design`

## Steps

### Step 1: collect the baseline numbers

Run `pnpm run dev` (twice, cold and warm), record from the 059 timings block: total boot, per-phase durations, per-service ready times, process count (`bos ps` + `ps aux | grep -c node`-style), and the steady-state RSS sum. These numbers are the design doc's "before" and the successor plan's acceptance bar.

**Verify**: numbers recorded in the design doc draft (a scratch note is fine until Step 4).

### Step 2: enumerate the dev serve's consumers (nothing gets deleted on a guess)

For each dev-serve capability, find its consumer and what breaks without the serve:
1. `remoteEntry.js` HTTP serving → the host's MF load (also SSR `ssr` container entries).
2. Plugin-UI static serving (rsbuild dev server, `BOS_UI_PORT`) → the host's UI compose/`<script>` wiring in dev.
3. The serve's own `/api/rpc` + OpenAPI → direct-to-plugin testing (curl, tests, agents). The host also serves `/api/rpc/{plugin}` in-process — is the serve-level surface used by anything the host surface can't do?
4. `pluginsClient` sibling loading in the serve (`serve.ts:239-262`) → only meaningful when the serve itself hosts a router; irrelevant if the serve stops running one.
5. Health/readiness probes → the orchestrator's awaitReady.
6. Per-plugin ports (ADR 0012) → direct access; also port-pinning persistence semantics.
Grep for consumers of each (e.g. `bos ps` display, regression harness `tests/regression/lib/start-stack.mjs`, docs). Output: a table in the design doc — capability → consumer → fate under single-runtime (absorbed by host / moved to a shell / deleted).

**Verify**: table complete; every "deleted" row has either zero consumers found or a named replacement.

### Step 3: design the target shape and write the decision doc

Write `docs/plans/v1-current/single-runtime-dev-design.md` with these sections (match the tone of existing v1-current docs):

- **Target**: dev serves become thin static+health shells (serve dists + readiness only; no plugin runtime, no DB, no initialize) OR disappear entirely with the host serving dists itself — pick one, with the tradeoff stated (shells preserve the port contract and ADR 0012 pinning; host-serving removes ~8 more processes but couples dist serving to host lifecycle).
- **Process budget**: enumerate the after-fleet (orchestrator + host + N shells + 7 watchers + 3 rsbuild dev) and the target count.
- **Reload story**: 060's watch keys on slot entry URLs — unchanged under either shape; state it.
- **Boot sequencing**: what can now start in parallel that couldn't before (shells are instant; host cold-compiles via its own retry budget per 059's parallel spawn).
- **ADR 0012 interaction**: per-plugin ports for shells remain pinned exactly as today (the port contract doesn't change even though the process behind it does).
- **Migration**: incremental flags (`bos dev --single-runtime` behind a dev flag first, flip default after regression-green), descriptor changes, what happens to `PLUGIN_READY_PATTERNS`.
- **Risks**: SSR entry serving for plugin-UI (the `ssr` container entries), anything discovered in Step 2 with an unresolved fate.
- **Acceptance bar**: measured against Step 1 baselines (boot total, process count, steady-state RSS) and green `test:regression:dev:*`.
- **Open questions**: anything Step 2 couldn't resolve, listed as explicit decision tickets.

**Verify**: the doc exists, contains every section, and every "deleted" row from Step 2 has a named fate.

### Step 4: ratify and index

Present the design to the operator (the dispatching reviewer). With ratification: add the successor implementation plan skeleton (`docs/plans/067-single-runtime-dev-implementation.md` — title, scope, phases, acceptance bar; full steps come after ratification) and update this plan's status row.

**Verify**: `docs/plans/README.md` has the 062 row updated and (if ratified) the successor row added.

## Test plan

- No runtime tests (design-only). The successor plan's acceptance bar is the test plan.

## Done criteria

- [ ] Baseline numbers recorded (boot, phases, per-service ready, process count, RSS)
- [ ] Consumer/fate table complete — no "deleted" row without a named replacement
- [ ] `docs/plans/v1-current/single-runtime-dev-design.md` written with all sections
- [ ] Operator ratification recorded in the doc (decision + date), or open questions escalated
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 2 finds a dev-serve consumer with no viable fate under single-runtime (e.g. a test harness or documented workflow hard-wired to per-plugin RPC ports that the host surface can't replicate).
- The 059 timing instrumentation isn't present (baseline unmeasurable) — 062 depends on it.
- The host-serving-dist variant requires host code changes large enough to be its own plan (note it in the doc; pick the shells variant unless the operator prefers otherwise).

## Maintenance notes

- The design doc is the contract for the successor implementation plan; changes to dev descriptor shape (e.g. new service kinds) invalidate the consumer table — re-run Step 2 then.
- Reviewer scrutiny: the port contract (ADR 0012) and the pluginsClient/`/api/rpc` surface parity claims.
- Explicitly out of scope (recorded so nobody re-audits): merging the orchestrator into the host process (loses supervision isolation); moving UI rsbuild dev under the host (rsbuild dev server is the product there).
