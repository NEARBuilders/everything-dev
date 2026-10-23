# 056 — Regression suite tuning: runtime cuts, gap folds, and CI-deps resilience

Written against commit `99e260e2` (2026-10-23). Produced by a review session over all
four regression suites (framework / http / browser / lib) with runtime profiling, gap
analysis, and Playwright/Go best-practice research mapped to this repo, plus a CI
incident investigation (runs 39990622648 et al., 2026-10-23). Companion to plans
050–052; the only overlap is plan 052 item 11 (dev:ssr testMatch), folded here as
Phase 2.2.

**Status (2026-10-23): PR 543 (zero-config dev) merged first per maintainer decision;
all phases implemented on top. The framework suite now boots stacks on per-stack
ephemeral pglite — the empty-export neutralization in `env.go` forces the zero-config
path even when a developer's local `.env` has dev DB URLs (empty export wins the
CLI's dotenv no-override load; the planner treats `""` as not-supplied; each
plugin.dev.ts's `|| pglite` fallback serves the consumer). `requireTestDatabases` was
deleted outright (the suite needs no databases), and the framework CI job dropped its
Postgres service containers. Concurrency is bounded by a slot semaphore
(`BOS_FRAMEWORK_STACK_SLOTS`, default 3; CI pins 2).

Chosen direction (maintainer decisions, this session): framework suite → parallelize
via `t.Parallel()`; browser suite → shard `start:*` across CI jobs and merge the two
dev legs into one job (ADR 0009 stands for intra-runner workers); fold all four
audited gaps (API-key E2E, CI-ungated adoption tests, SIGINT + `bos kill --all`,
loud DB-down); harden the Playwright system-deps apt path that killed three CI runs
on 2026-10-23.

## Context

- The framework suite boots 5–7 full dev stacks strictly sequentially (distinct port
  blocks 5300/5400/5600+5700/5800/5810/5900 — designed for concurrency, run serially).
- The browser suite runs `workers: 1` / `fullyParallel: false` everywhere; CI carries
  a four-mode matrix (dev:ssr, dev:csr, start:ssr, start:csr).
- Coverage holes: no API-key (`x-api-key`) E2E anywhere (`auth_api_key_flow_test.go`
  is misnamed — anonymous sessions only); plan-036 adoption tests gated off in CI
  (`BOS_TEARDOWN_ADOPTION` appears nowhere in ci.yml); no SIGINT quit path; no
  `bos kill --all`; `requireTestDatabases` silently `t.Skipf`s in CI when test
  Postgres is down (false green).

### CI incident (2026-10-23) — the failure class Phase 5 resolves

Three runs cancelled, identical signature: a browser-dev matrix leg hit its
`timeout: 10` job ceiling (ci.yml:771-778) while stuck in "Install Playwright system
deps" — `playwright install-deps chromium` (ci.yml:853-855) runs apt-get on every
run when the browser-binary cache hits, and the runner's apt hung:

| Run | Leg | Killed step | Elapsed |
|---|---|---|---|
| 39978501575 | dev:csr | Install Playwright system deps | 10m18s |
| 39980207060 | dev:ssr | Install Playwright system deps | 10m18s |
| 39990622648 | dev:csr | Install Playwright system deps | 10m12s |

Proof it is runner flakiness, not the commit: the sibling dev:ssr leg on 39990622648
was green in 2m04s with the same steps. A fourth cancellation (39978261807,
start:ssr, no cancelled step) is the benign concurrency `cancel-in-progress`
supersede — out of scope. No diagnostics exist for any of the three: artifact upload
is `if: failure()` (ci.yml:873), which never fires for timeout-cancels.

## Phase 0 — Parallelization prerequisites (must land before Phase 1.1)

**0.1 — Make `AssertNoRepoSurvivors` parallel-safe.** The scan
(`tests/regression/framework/verify.go:181-202`) flags any repo-root
`rspack|rsbuild|cli.ts dev` process; under `t.Parallel`, sibling test stacks match
and false-fail. Every stack child inherits the test's unique `BO_PID_REGISTRY_PATH`
(`stack.go:92-97`, tempdir per test). Fix: for each candidate pid, read its
environment (Linux `/proc/<pid>/environ`; macOS via `ps` env output — verify on
darwin first) and exclude candidates whose `BO_PID_REGISTRY_PATH` differs from this
test's own. Untagged processes (a developer's own dev stack) keep today's behavior —
that false-positive risk predates this plan and is unchanged. Fallback if env
reading proves unreliable on macOS: skip the repo scan whenever parallel sibling
registries are detected, relying on the pid/port assertions only.

**0.2 — De-collide adoption port blocks.** `TestNextBootAdoptsOrphans`
(`adoption_test.go:39`) reuses block 5600 from `TestHardKillThenBosKillReapsOrphans`
under a sequential-execution assumption. Renumber its two boots to 5950/5960 so both
adoption tests can run parallel.

**0.3 — CPU-headroom gate.** Run the full parallel suite locally once; if boots push
the 3-min `readyTimeout` (`stack.go:19`) under concurrency, either raise it while
`t.Parallel` is active or parallelize in two waves. Empirical — do not assume.

## Phase 1 — Framework (process-death) suite

1. **`t.Parallel()` all seven tests** (after 0.1–0.3): graceful_quit, boskill,
   orphan_watch, both interactive_quit tests, both adoption tests (now unhidden in
   CI per 1.6). Expected wall-time: ~N boots → ~1 boot.
2. **Deterministic raw-mode settle.** Replace the fixed 1s sleep
   (`interactive.go:20,125`) with an explicit readiness signal: the interactive
   renderer (`packages/everything-dev`) emits a short escape sequence
   (e.g. `\x1b]bos;ready\x07`) once raw mode is enabled; `WaitTuiMounted` waits on
   that marker, keeping the 1s settle only as a fallback timeout path (older CLIs).
   This removes the exit-130 ISIG race that makes `TestInteractiveQuitByCtrlC` the
   suite's most timing-fragile assertion. CLI change → changeset required (this repo
   is the framework home; flows outward via sync).
3. **Overlap the two 10s windows** — `AssertAllDead` and `AssertPortsFree` run as
   concurrent goroutines (independent observations).
4. **New `TestSigintQuitKillsEverything`** — plain `kill -INT` on a non-interactive
   session; same assertion shape as `TestGracefulQuitKillsEverything`. Closes the
   `docker stop`/CI-container stop path. Own port block (6000).
5. **New `TestBosKillAllReapsEverything`** — `bos kill --all` in the temp registry
   against a live session. Port block 6100.
6. **CI ungates adoption** — `BOS_TEARDOWN_ADOPTION=1` on the framework job
   (ci.yml:~752), so plan-036 acceptance actually runs in CI.
7. **Loud DB-down in CI** — `requireTestDatabases` (`stack.go:69-78`) fails (not
   skips) when `CI=true`; keeps the local `t.Skipf`.

## Phase 2 — Browser suite: shard, not workers

1. **Shard the start:* CI legs.** Keep `workers: 1` / `fullyParallel: false` (ADR
   0009 stands). CI browser start jobs pass `--shard x/y` via a matrix dimension
   (start: 2 shards; file-level granularity is fine for ~15 spec files — measure
   balance; device-link has the most tests). Local runs unchanged.
2. **Fold plan 052 item 11** — add one SSR-assertion spec to `dev:ssr`'s testMatch
   (root HTML carries `window.__RUNTIME_CONFIG__` and not the CSR-fallback shell —
   the browser-side counterpart of http's `TestBootSurface` root gate), so the two
   dev projects stop running identical suites.

## Phase 3 — API-key E2E spec (closes the biggest hole)

New `tests/regression/browser/specs/api-key-auth.spec.ts`, full-suite projects only
(same gating as `ssr-compose`). Zero UI changes needed — the surface is already
instrumented (`ui/src/components/api-key-manager.tsx`):
- Create: member persona → `/settings/api-keys` → fill `api-key-name-input`
  (`api-key-manager.tsx:56`) → click `api-key-create-button` (`:84`) → read the
  secret from the reveal input `[aria-label="New API key"]` inside the
  `api-key-reveal` card (`:117-136`).
- Use via the Playwright `request` fixture with `x-api-key`: `GET /api/ping` → 200;
  MCP `tools/list` → 200 with tools (also closes the MCP-tool-invocation gap); one
  plugin RPC call → 200.
- Negative: garbage key → 401 on `/api/ping`.

## Phase 4 — HTTP suite micro-trims

`TestRateLimiting`: pin `RATE_LIMIT_MAX=20` (process.go `buildTargetEnv`), shrink
the burst to ~5×10 requests, derive sleeps from `RATE_LIMIT_WINDOW_MS` instead of
the hardcoded 1200ms. Everything else stays — the shared-boot model is already the
best practice the suite could have.

## Phase 5 — CI resilience (the 2026-10-23 failure class)

1. **Bound and retry the apt step** on both browser jobs (dev ci.yml:849-855, start
   ci.yml:981-987): `timeout 240 pnpm exec playwright install-deps chromium` in a
   2–3 attempt loop. A hung apt dies in 4 min, not 9+, and a retry usually succeeds
   (transient mirror stalls).
2. **Dev timeouts 10 → 20** (ci.yml:771,774) — healthy legs run ~2m; the headroom
   costs nothing green and absorbs a full retry cycle.
3. **Artifacts on cancel too** — all five ci.yml upload steps `if: failure()` →
   `if: ${{ !success() }}` (fires on failure and timeout-cancel; lines 579, 674,
   756, 873, 1005), step names "...on failure or cancel". Today's incident would
   have left logs + watchdog + trace instead of nothing.
4. **Merge the two dev legs into one job** — `Regression Browser (dev)` running
   `--project=dev:ssr` then `--project=dev:csr` sequentially: one apt exposure
   instead of two, one install/build fixed cost instead of two. With Phase 2.2 the
   merged job runs genuinely different work per project. Sharding (Phase 2.1)
   stays scoped to the start:* full-suite legs.

## Verification gates (per phase)

```bash
pnpm run test:db:up
pnpm run test:regression:framework        # Phases 0-1; wall-time drop, 3 clean consecutive runs
pnpm run test:regression:http:dev         # Phase 4
pnpm run test:regression:browser:dev:ssr  # Phases 2-3 (full-suite parts need start:ssr locally or rely on CI)
pnpm run typecheck
```

Executor caveat: if the dev-mode stack won't boot locally (plan 052 addendum —
transient environment blocks), stop and report rather than working around; the
API-key spec can be verified via `start:ssr` regardless.

## Done criteria

- All touched suites green locally; CI green over 2–3 subsequent runs with zero
  dev-leg deps cancels.
- Framework wall-time measurably lower (record before/after in this file's status).
- The four gap folds present and green: API-key spec, adoption tests in CI,
  SIGINT + `bos kill --all` tests, loud DB-down.
- No regression in existing coverage: no deleted assertions (deletions here are
  sleeps and duplicated fixed costs, not checks).

## Escape hatches

- If macOS env reading for 0.1 proves unreliable, use the documented fallback (skip
  the repo scan under detected parallel siblings) rather than blocking.
- If `t.Parallel` boots thrash a small CI runner (0.3), parallelize in two waves
  and record the split here.
- If the merged dev job's two sequential invocations exceed 20 minutes, revert 5.4
  and keep the hardened separate legs.

## Out of scope

- backcompat CI wiring (plan 052 open decision #2 — nightly, separate decision).
- Tenant-surface regression coverage (`/tenants/bindings`, shared-host overrides).
- Host `runtime-remote` repair-or-retire (plan 052 #1).
- MCP tool *invocation* beyond the API-key spec's `tools/list` (deeper call flows).
