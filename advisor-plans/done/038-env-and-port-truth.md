# Plan 038: Env & port truth — preflight actually probes, CORS/BASE_URL can't go stale, DB ports stop resetting

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the plans index (see 037's note about `.opencode/plans/` placement).
>
> **Drift check (run first)**: `git diff --stat c26e8699e..HEAD -- packages/everything-dev/src/infra/preflight.ts packages/everything-dev/src/infra/planner.ts packages/everything-dev/src/cli/infra.ts packages/everything-dev/src/env/project-env.ts packages/everything-dev/src/orchestrator.ts packages/everything-dev/src/dev-program.ts packages/everything-dev/src/app.ts`
> Plan 037 touches `orchestrator.ts`/`dev-session.ts` (expected drift — only env composition sites matter here). Any other in-scope drift beyond 037/036 work: STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (env precedence is relied on by the regression harness; DB port semantics change generated compose files)
- **Depends on**: 037 (recommended — its teardown fixes de-risk the live verification); coordinates with 036 (see "Amendments to plan 036" — do NOT execute those sections yourself unless also executing 036)
- **Category**: bug
- **Planned at**: commit `add676edc`, 2026-09-23

## Why this matters

A live session ran drifted on host port 3004 while the auth plugin warned `CORS_ORIGIN (http://localhost:3000) does not include the host origin http://localhost:3004` — sign-in silently broken. The audit traced three verified paths where a stale origin beats the planner-generated one, one of which *persists* the stale value into `.env`. Separately, the documented DB preflight is a silent no-op (its URL parser cannot parse credentialed connection strings — i.e. every URL the planner itself generates), and the DB config builder resets persisted ports to 5432/5433 on every run, so with the standard leave-containers-running workflow, `bos dev` writes DB URLs pointing at ports nothing listens on. This plan makes the resolved host port the single source of truth for every consumer tier, makes preflight real, and stops the DB port reset.

## Current state

- **`infra/preflight.ts:20-30`** — `parseLocalUrl` uses `url.match(/:\/\/([^:/]+):(\d+)/)`. For `postgres://everythingdev:everythingdev@localhost:5432/api_db` the regex captures the username as host and then fails on the password — returns `null`. Every generated `*_DATABASE_URL` (credentialed format from `cli/infra.ts:228,279,292`) is therefore never probed; only `redis://localhost:6379` parses. Also `preflight.ts:122-124`: a ternary checking `secret.endsWith("_DATABASE_URL")` inside the `kind === "postgres"` branch is always true — wrong failure message for API/auth DBs. `checkPgConnection` (55-79) already uses `new URL()` correctly.
- **`orchestrator.ts:312-326`** — `mergeGeneratedOverFileEnv`: shell tier (`shellEnv`, a raw `process.env` snapshot from `env/project-env.ts:33-37`) overrides generated values for ANY key present. `env/project-env.ts:73,82` — `syncEnvFile` skips rewriting `.env` for shell-present keys, so a wrapper that sourced a stale `.env` (direnv, `set -a; . ./.env`, dotenv-cli) both wins the child env AND keeps the stale value on disk.
- **`dev-program.ts:171`** — `.env` is loaded into `process.env` BEFORE planning; the post-plan sync (314-320) never corrects the CLI process's own env (second load is a no-op via `loadedDirs`, and dotenv doesn't override existing keys). In-process consumers see the stale value: `spawnRemoteHost` (orchestrator.ts:253-262) runs the remote host in-process passing only `{ PORT }`, so a remote-host dev session's auth wiring (`host/src/services/plugins.ts:316-331`, reading CORS via Effect Config) gets stale `process.env.CORS_ORIGIN` while `BOS_RUNTIME_CONFIG` says 3004. This is the exact incident path.
- **`dev-program.ts:475-482`** — `bos start` defaults `CORS_ORIGIN` only when unset; a repo's dev `.env` (seeded `localhost:3000` from `.env.example`) silently wins in production starts.
- **`cli/infra.ts:250-257`** — `buildDatabaseConfigs` unconditionally sets `portMap[slug] = 5432` (5433 for auth) for every current secret, discarding `persisted.postgresPorts`; URLs are built from the (possibly `pickAvailable`-drifted) picked port (planner.ts:217,228) while `docker-compose.yml` (materializer) always renders 5432/5433 from the same reset — env and compose can disagree. Redis honors persisted ports via `resolvePort` (cli/infra.ts:118-125) — mirror that. `tests/unit/infra.test.ts:261-331` currently enshrines the reset.
- **Conventions**: Effect 4; env precedence documented as "shell-exported > generated > .env" (`tests/unit/spawn-env.test.ts:15` pins it — the shell tier itself stays, this plan narrows *which keys* it owns and fixes propagation, see Step 2).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Package tests | `cd packages/everything-dev && bun run test` | all pass |
| Root tests | `bun run test` (includes regression lib) | exit 0 |

## Scope

**In scope**:
- `packages/everything-dev/src/infra/preflight.ts`
- `packages/everything-dev/src/cli/infra.ts` (buildDatabaseConfigs + URL building)
- `packages/everything-dev/src/env/project-env.ts` (sync + capture semantics)
- `packages/everything-dev/src/dev-program.ts` (env application + start CORS default)
- `packages/everything-dev/src/orchestrator.ts` (composeSpawnEnv/mergeGeneratedOverFileEnv site only)
- `packages/everything-dev/tests/unit/` (preflight test create; infra.test.ts, spawn-env.test.ts updates)

**Out of scope**:
- Port allocation semantics, block layout, drift persistence — plan 036
- Dev-session lifecycle — plan 037
- `host/src/services/*` (the warning *emitter* is correct; the CLI feeds it stale data)
- docker-compose service definitions beyond port rendering

## Steps

### Step 1: Preflight actually probes (CORRECTNESS-01)

Rewrite `parseLocalUrl` with `new URL(url)`: hostname must be `localhost`/`127.0.0.1`, port from `url.port` with fallbacks 5432 (postgres) / 6379 (redis). Delete the always-true ternary at 122-124 and give API/auth DBs an accurate failure hint. Create `tests/unit/preflight.test.ts` with the planner's exact credentialed format (`postgres://user:pass@localhost:5432/db`) asserting a probe target is produced, plus a non-local URL asserting it is skipped.

**Verify**: `cd packages/everything-dev && bun run test -- preflight` → pass. Manual: with `docker compose up -d --wait` running, `bun run dev` preflight passes; with containers stopped, the guided `docker compose up` failure appears (previously: silent pass then runtime connection refused).

### Step 2: One origin truth — close the three CORS/BASE_URL leaks (CORRECTNESS-03)

Principle: the resolved host port (from `plan.envGenerated`) is authoritative for `BASE_URL`/`CORS_ORIGIN` at EVERY tier. Shell-tier override stays for keys the harness legitimately owns, but these two origin keys are always generated-owned:

1. **Shell tier**: in `mergeGeneratedOverFileEnv` (or the capture that builds `shellEnv`), exclude `BASE_URL` and `CORS_ORIGIN` from the shell tier (generated always wins for these two keys). Also stop skipping the `.env` rewrite for them in `syncEnvFile` (a stale on-disk value gets corrected next run).
2. **In-process tier**: after `projectEnv.sync` in `dev-program.ts` (~314-320), `Object.assign(process.env, plan.envGenerated)` for the origin keys (or all generated keys not shell-owned) so `spawnRemoteHost`'s in-process host and any direct `process.env` readers see the same truth as spawned children.
3. **`bos start` tier**: in `startBootstrap`, treat a `localhost` CORS_ORIGIN/BASE_URL as unset for a production start — warn loudly and derive from the resolved host URL/domain (the drift-proof equivalent of the existing unset-default).

Add an end-to-end style unit test: plan a runtime config with host port 3004; assert the value seen by (a) `composeSpawnEnv` output, (b) `process.env` after the dev-program application step, (c) a simulated `bos start` env — all `http://localhost:3004`.

**Verify**: `bun run test -- spawn-env` (update the pinned case: shell may still win for arbitrary keys, NOT for the two origin keys) + new test pass; root `bun run test` green (regression env tests unchanged).

### Step 3: DB ports stop resetting (CORRECTNESS-02)

In `buildDatabaseConfigs` (`cli/infra.ts:250-257`): only assign 5432/5433 when the slug is absent from the incoming `portMap` (mirror `resolvePort` for redis); build URLs from the resolved per-slug port, not a hardcoded 5432. Ensure the materializer's compose rendering consumes the same resolved spec (planner passes its picked ports back — the spec must not re-derive). Migration story: existing `.bos/infra-state.json` files with `postgresPorts` entries become honored (previously write-only noise) — that is the intended fix; compose files regenerate with the honored ports. Update `tests/unit/infra.test.ts:261-331`: persisted `5436` + busy 5432 → stable 5436 in both `.env`-bound `envGenerated` and the compose model.

**Verify**: package tests pass with the updated assertion; manual: `bun run test:db:up` then `bun run dev` twice — second run keeps the same DB URLs as the first (no churn in the `[env] ... updated` drift log).

## Test plan

- Create `tests/unit/preflight.test.ts` (Step 1 cases; model on `tests/unit/materializer.test.ts` fixture style).
- Extend `spawn-env.test.ts` with the origin-key exception case.
- Update `infra.test.ts` port round-trip assertions (Step 3).
- New origin-truth test (Step 2) — place in `tests/unit/spawn-env.test.ts` or a new `env-truth.test.ts`.

## Done criteria

- [ ] `bun typecheck`, `bun lint` exit 0; package + root tests pass
- [ ] A session drifted to a non-3000 host port produces `BASE_URL`/`CORS_ORIGIN` matching that port in: spawned child env, the CLI process env, `.env` after sync, and `bos start` derivation
- [ ] With dev containers up, preflight probes every `*_DATABASE_URL`; with them down, it fails with the guided message
- [ ] Two consecutive `bun run dev` runs with containers up produce zero DB-URL drift lines
- [ ] Changeset added

## STOP conditions

- The regression harness depends on shell-exported `CORS_ORIGIN`/`BASE_URL` winning over generated values for a legitimate reason discovered in `tests/regression/` — report the site; do not narrow the shell tier until reconciled.
- Honoring persisted postgres ports breaks a committed `docker-compose.yml` contract that external tooling (CI, docs, child repos) depends on beyond regeneration.
- `bos start`'s production CORS derivation conflicts with an existing production deployment's expectation (check `host/` SSR/CSP wiring) — report with the conflict.

## Amendments to plan 036 (for the 036 executor / operator — do not execute here)

1. **Phase 2 scope addition (CORRECTNESS-05)**: when converging allocators and deleting `prepareDevelopmentRuntimeConfig`, also delete or reconcile `materializeLocalDevEnv` (`infra/materializer.ts:103-112`) — it is production-dead, rewrites the entire `.env` destructively, and rotates `BETTER_AUTH_SECRET` per render (`cli/infra.ts:405-407`). Its unit test (`materializer.test.ts:117-131`) certifies the wrong behavior. The live planner also clobbers remote `host.url` with `http://localhost:<picked>` (`planner.ts:449-457`) while app.ts's dead copy gates that correctly (`app.ts:261-270`) — port the gate into the planner or document the clobber as intentional for `bos start`.
2. **Phase 2.5 detail (BUG-03/CORRECTNESS-04)**: registry hardening must include pid-unique tmp paths (`${path}.${process.pid}.tmp`), a `try/catch` around `registerStandalone` in dev-session (currently the only unguarded registry call — a write race crashes session B as an unhandled defect), and short-timeout lockfile serialization of read-modify-write cycles.
3. **Phase 4 addition (DIR-02 docs ride-along)**: 036's Phase 4 must update `AGENTS.md` (lines ~240 "auto-picked and persisted", ~254 "persisted and reused across restarts") and `packages/everything-dev/skills/dev-workflow/SKILL.md` port sections in the same PR — ADR 0012 §4 reverses the persistence behavior those lines describe, and the skill ships in the published package. Without this, the primary agent-facing docs flip from true to wrong on landing.
4. **Phase 0 note**: characterization pins post-037 behavior (037 is 036's prerequisite for exactly this reason).

## Maintenance notes

- The `DB_SSL_REJECT_UNAUTHORIZED` default inversion (SEC-02) lives in plan 039 — this plan's URL handling must not silently depend on the current insecure default.
- Reviewer focus: Step 2's shell-tier narrowing is the risky change — the regression harness's env tests are the tripwire; Step 3 changes generated compose output for existing users (regeneration is expected, deletion of volumes is not).
- Deferred: `bos start` running the dev planner at all (CORRECTNESS-07 — 036 Phase 2's persist-only-explicit absorbs the practical impact; a fuller "start doesn't need dev ports" refactor is not scheduled).
