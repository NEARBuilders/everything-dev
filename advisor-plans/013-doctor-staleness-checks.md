# Plan 013: `bos doctor` — detect the two stale-state classes that keep biting

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- packages/everything-dev/src/infra/preflight.ts packages/everything-dev/src/plugin.ts packages/everything-dev/src/build.ts packages/everything-dev/src/cli/status.ts packages/everything-dev/src/shared-deps.ts packages/everything-dev/src/cli/contract.meta.ts`
> If any in-scope file changed since this plan was written (plans 006/011 touch `contract.meta.ts` — expected drift), compare "Current state" against live code; on a mismatch beyond that, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

Two stale-state classes caused repeated multi-hour mystery crashes during the recent Effect 4 migration, and the dev tooling cannot see either:
1. **Stale `dist/`** — `packages/everything-dev` and `packages/every-plugin` are consumed via their built `dist/` (the `bos` bin itself is `./dist/cli.mjs` per `package.json:191-194`), so a stale dist runs old code — including the very staleness guard that's supposed to rebuild it. Symptom class: `Context.Tag is not a function`-style runtime crashes until a manual `bun run build`.
2. **Nested `node_modules` shadowing** — a workspace-local `node_modules/<singleton>` copy (e.g. `ui/node_modules/@orpc/client` v1.14.3 shadowing the hoisted v2) resolves before the root version, invisibly, until a runtime import error. This bit three separate times in one migration.

A doctor module with two read-only probes, wired into dev preflight (fail-fast) and `bos status` (report), turns both classes into a one-line diagnostic.

## Current state

- `packages/everything-dev/src/infra/preflight.ts:81-104` — the ONLY dev preflight today: parses `*_DATABASE_URL`/`*_REDIS_URL` env vars and probes TCP/Postgres reachability. Nothing else. (Lines 106-152 hold the failure-message rendering.)
- `packages/everything-dev/src/plugin.ts:698-707` — `buildEverythingDevQuietly`/`buildEveryPluginQuietly`, gated by `shouldBuildPlugin` (~695-696); the dev flow's existing dist-rebuild hook (silent rebuild, no reporting).
- `packages/everything-dev/src/build.ts:597-609` — existing dist-staleness mtime logic: compares a single dist entry (`dist/index.mjs`, `dist/build/rspack/plugin.mjs`) against newest src. Reuse this comparison — don't invent a second.
- `packages/everything-dev/src/cli/status.ts:51` — `bos status` already resolves framework packages per project (the natural non-blocking report surface).
- `packages/everything-dev/src/shared-deps.ts:196-269` — `syncResolvedSharedDeps` syncs catalog + bos.config shared entries; nothing inspects installed node_modules layout (verified: repo-wide grep finds no singleton-resolution check).
- The singleton set is defined in `package.json` → `workspaces.catalog` (`effect`, `@orpc/*`, `@module-federation/*`, `react`, `@tanstack/*`) — read it dynamically, don't hardcode the list.
- The dev preflight invocation point: `plugin.ts:781-792` (where the env preflight is called before starting services).
- Conventions: everything-dev src uses Effect 4 (`Effect.callback`, `Effect.gen`); CLI output goes through the timing/logging helpers neighboring commands use.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| everything-dev tests | `cd packages/everything-dev && bun run test` | 420+ pass (2 skipped) |
| everything-dev dist | `cd packages/everything-dev && bun run build` | success |
| CLI smoke | `node packages/everything-dev/dist/cli.mjs status` | runs, includes staleness section |

## Scope

**In scope**:
- `packages/everything-dev/src/infra/staleness.ts` (create — the doctor module)
- `packages/everything-dev/src/infra/preflight.ts` (wire in)
- `packages/everything-dev/src/plugin.ts` (preflight call site only)
- `packages/everything-dev/src/cli/status.ts` (report section)
- `packages/everything-dev/tests/unit/staleness.test.ts` (create)

**Out of scope**:
- Auto-repair (rebuilding dists / pruning node_modules automatically) — detection + remediation TEXT only; the existing `buildEverythingDevQuietly` behavior stays as is.
- `bun install`-time hooks (postinstall scripts are deliberately absent — `--ignore-scripts` is a repo security stance per AGENTS.md "CI Hardening").
- Registry/lockfile policy changes.

## Git workflow

- Branch: `improve/013-doctor-staleness`.
- Commit style: `feat(everything-dev): staleness doctor for dist + nested singleton shadowing`.
- Do NOT push unless instructed.

## Steps

### Step 1: The staleness module

Create `packages/everything-dev/src/infra/staleness.ts` exporting a pure-ish `checkEnvironmentStaleness(workspaceRoot: string): Promise<StalenessReport>` where:

```ts
type StalenessFinding =
  | { kind: "nested-singleton"; workspace: string; pkg: string; nestedVersion: string; rootVersion: string; remediation: string }
  | { kind: "stale-dist"; pkg: "everything-dev" | "every-plugin"; remediation: string }
  | { kind: "stale-cli-binary"; note: string; remediation: string };
```

Probe 1 — nested singletons: for each workspace directory under `workspaces` (read the globs from root `package.json`), for each singleton package name (union of the catalog keys for `effect`, `@orpc/*`, `@module-federation/*`, `@tanstack/*`, `react`/`react-dom`), resolve `require.resolve("<pkg>/package.json", { paths: [workspaceDir] })` and compare the resolved path against the root resolution (`require.resolve("<pkg>/package.json", { paths: [root] })`): if the path differs, record the nested version vs the root version. Remediation text: `rm -rf <workspace>/node_modules/<pkg> && bun install`.
Probe 2 — dist staleness: reuse the mtime comparison from `build.ts:597-609` (extract or call it) for both framework packages.
Probe 3 — stale CLI binary: if the running `dist/cli.mjs` mtime is older than the newest `src/**` file of everything-dev itself, report "the running bos binary predates the newest source; run `cd packages/everything-dev && bun run build`".

**Verify**: `cd packages/everything-dev && bunx tsc --noEmit` → exit 0.

### Step 2: Unit tests with a fixture workspace

Create `tests/unit/staleness.test.ts` building a temp directory (use the repo's existing temp-dir test patterns — check a neighboring test for the convention) with: a fake root `node_modules/<pkg>` v2 + a fake workspace `node_modules/<pkg>` v1 → probe 1 reports it; a fake stale dist (older mtime than fake src) → probe 2 reports it. Also a clean case asserting zero findings.

**Verify**: `cd packages/everything-dev && bun run test` → new staleness tests pass.

### Step 3: Wire into dev preflight (fail-fast)

At `plugin.ts:781-792` (the existing preflight call), run `checkEnvironmentStaleness` after the env preflight. Findings print their remediation lines and — for `nested-singleton` and `stale-dist` — the preflight FAILS with the same clear `docker compose up -d --wait`-style remediation UX the env preflight already uses (read `preflight.ts:106-152` and match the message rendering). Exception: `stale-cli-binary` is a warning, not a failure (it would deadlock: the binary can't rebuild itself mid-flight).

**Verify**: `node packages/everything-dev/dist/cli.mjs dev` in this repo → starts normally (this repo is clean — the probes find nothing; if they DO find something, that's a live finding — report it, don't tune the probe to pass).

### Step 4: Wire into `bos status` (report)

In `cli/status.ts` (~line 51, where framework packages are already resolved), add a "Staleness" section printing the findings (or "no staleness detected"). Non-blocking — status exits 0 regardless.

**Verify**: `node packages/everything-dev/dist/cli.mjs status` → shows the staleness section; `bun run test` still green.

### Step 5: Full gates

`bun typecheck && bun lint`; rebuild dist (`bun run build` in the package) and re-smoke status.

**Verify**: all green per the commands table.

## Test plan

- Fixture-based unit tests (Step 2): nested shadow detected with correct versions; stale dist detected; clean workspace → zero findings; remediation strings present.
- Existing 420+ suite must stay green (the dev-flow change must not fire on this clean repo — if it does, that's signal, see STOP).

## Done criteria

- [ ] `checkEnvironmentStaleness` exists with the three probes; unit tests cover detect/clean cases
- [ ] Dev preflight fails fast on nested-singleton/stale-dist with remediation text; `stale-cli-binary` warns only
- [ ] `bos status` reports the section non-blockingly (smoke-verified via dist CLI)
- [ ] `bun typecheck`, `bun lint`, everything-dev suite pass
- [ ] Changeset added (everything-dev minor)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- The probes fire on THIS repo right now (a live nested-copy or stale-dist exists) — report the finding as a real result; do not weaken probes to get a green run.
- `require.resolve` with `paths` can't see nested copies under bun's symlinked layout (bun uses symlinks for workspaces) — then the probe must walk `node_modules` directories directly (`existsSync(join(workspace, "node_modules", pkg))` + read its package.json); report which strategy you used.
- The dev preflight call site at `plugin.ts:781-792` has moved or its failure UX can't be reused.

## Maintenance notes

- New singleton categories (a future `@effect/platform` adoption) just join the catalog — the probe reads it dynamically.
- Reviewer: confirm the preflight failure path prints remediation for BOTH framework packages and points at `bun install` for nested copies (the deletion is safe — the hoisted root copy serves the workspace).
- When `bos doctor` becomes a standalone command someday (it's a natural follow-up), the module is already command-shaped.
