# Plan 041: CLI hygiene batch — dead deps, honest manifest, no private-API casts, docs that match commands

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the plans index.
>
> **Drift check (run first)**: `git diff --stat c26e8699e..HEAD -- packages/everything-dev/package.json packages/everything-dev/src/cli/parse.ts packages/everything-dev/src/cli/help.ts packages/everything-dev/src/cli/catalog.ts packages/everything-dev/src/cli/sync.ts packages/everything-dev/src/cli/init.ts packages/everything-dev/src/db/core.ts packages/everything-dev/src/db/run-migrations.ts packages/everything-dev/src/near-cli.ts packages/everything-dev/src/near-signer.ts packages/everything-dev/src/delegate-signer.ts AGENTS.md`
> Other plans touch none of these except AGENTS.md (036's docs amendment touches port lines — disjoint from the `bos info` line). Other drift: STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx, tech-debt
- **Planned at**: commit `add676edc`, 2026-09-23

## Why this matters

A batch of small, verified hygiene defects that each cost real time: two Effect platform packages ship as dependencies with zero imports (one peer-incompatible with the vendored effect pin), `zod` is a runtime import of the published `bos` bin but only a peer dependency (crashes under strict-peer installers), the package bypasses the root catalog for `@types/node`/`vitest` (two versions in one lockfile, nothing documents why), the CLI parser reaches into oRPC's private `~orpc` internals through an `any` cast (breaks at runtime, not typecheck, on the next @orpc upgrade), AGENTS.md sends agents to a `bos info` command that does not exist, and two tiny duplications (snapshot hash helper, SQLSTATE retry lists) invite drift. All are S-effort with clean verification.

## Current state

- **`packages/everything-dev/package.json:277-278`** — `"@effect/platform": "^0.97.2"`, `"@effect/platform-node": "4.0.0-rc.112"` in `dependencies`; repo-wide grep: zero imports of either in `src/` or `tests/`. `@effect/platform@0.97.2` peers `effect ^3.22.2` while the repo pins `effect@4.0.0-rc.112` (structural mismatch, not drift).
- **`package.json:305`** — `zod: "catalog:"` in `peerDependencies` only; the bin's import chain `cli.ts → cli/catalog.ts:1 → contract.ts:2` is `import * as z from "zod"` (also `src/sdk.ts:10` re-exports it).
- **`package.json:354,361`** — `"@types/node": "^22.10.2"`, `"vitest": "^4.0.18"` vs root catalog `^25.0.3` / `^4.1.8`; `bun.lock` shows the split resolutions; no doc records the Node-22 pin as deliberate. Engines: `node >=20.11`.
- **`src/cli/parse.ts:64-68`** — `(descriptor.procedure as any)["~orpc"]?.inputSchemas` to get the Zod schema; `~orpc` is an oRPC implementation detail. The schemas are statically available: `src/contract.ts` exports `*OptionsSchema` per command; `src/cli/catalog.ts:21-36` builds the command catalog from `bosContract`.
- **`AGENTS.md:273`** — "`bos info` # Show configuration" — no `info` command exists in the contract (`src/contract.ts:591-692`); running it exits 1 with "Unknown command: info". Real equivalent: `bos config`.
- **`src/cli/sync.ts:71-73` and `src/cli/init.ts:1291-1293`** — two identical `sha256(...).digest("hex").substring(0,16)` helpers (snapshot hash format must stay identical across writers/readers).
- **`src/db/core.ts:92-100`** (`RETRYABLE_SQLSTATES`: 42P06, 42710, 42701, 42P07, 23505, 40001, 40P01) vs **`src/db/run-migrations.ts:59`** (`DEFAULT_DUPLICATE_SQLSTATES`: 42710, 42701, 42P07) — two overlapping hand-maintained lists.
- **`src/near-cli.ts:104-123`** — `checkNearCliInstalled` (Effect) and `isNearCliInstalled` (plain async) duplicate one check; `src/near-signer.ts:33-40` / `src/delegate-signer.ts:71-76` duplicate `assertPrivateKey`; the gas/deposit literals (`"300 Tgas"`, `"0 yocto"`) appear in `near-signer.ts:96-115`, `delegate-signer.ts:30-42`, and `near-cli.ts:143-144`.
- **Conventions**: root catalog pinning for workspace deps; conventional commits; changesets for user-facing changes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install/relock | `bun install` | exit 0, lockfile updated |
| Typecheck | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Package tests | `cd packages/everything-dev && bun run test` | all pass |
| Package dist | `cd packages/everything-dev && bun run build` | success |
| CLI smoke | `node packages/everything-dev/dist/cli.mjs --help` then `... ps` | both run |

## Scope

**In scope**:
- `packages/everything-dev/package.json` (+ `bun.lock` via install)
- `packages/everything-dev/src/cli/parse.ts`, `src/cli/catalog.ts`
- `packages/everything-dev/src/utils/` (shared hash helper, create)
- `packages/everything-dev/src/cli/sync.ts`, `src/cli/init.ts` (hash import only)
- `packages/everything-dev/src/db/core.ts`, `src/db/run-migrations.ts`
- `packages/everything-dev/src/near-cli.ts`, `src/near-signer.ts`, `src/delegate-signer.ts`
- `AGENTS.md` (the one `bos info` line)

**Out of scope**:
- `@clack/prompts` / chalk / execa major upgrades (DEP-04 — a coordinated engines decision, deliberately not batched)
- Help rendering of flag metadata (DIR-05/plan 011 owns it)
- `src/descriptor/resolve.ts` dead-export decision (needs external-consumer research — see Maintenance notes)

## Steps

### Step 1: Manifest honesty (DX-01/DEP-01 + DEP-02 + DEP-03)

1. Remove `"@effect/platform"` and `"@effect/platform-node"` from `dependencies`.
2. Add `"zod": "catalog:"` to `dependencies` (keep the peer entry — the app-framework surface still declares it).
3. Switch `"@types/node"` and `"vitest"` (devDependencies) to `"catalog:"`. If typecheck then surfaces Node-25-only API assumptions in this package, fix them (they'd be latent bugs — the package *runs* on newer Node via engines). If the Node-22 floor was deliberate child-project compat, STOP per conditions below.

**Verify**: `bun install` → lockfile resolves single `@types/node` + `vitest` versions; `bun typecheck`; `bun run build` (dist externals still correct for zod — the bin must resolve it at runtime); `node packages/everything-dev/dist/cli.mjs ps` runs (proves zod resolves).

### Step 2: Kill the `~orpc` cast (DX-05)

In `src/cli/catalog.ts`, build a `Record<commandKey, ZodSchema>` from the exported `*OptionsSchema` values in `src/contract.ts` (they're the same schemas the contract routes use) and attach it to each `CommandDescriptor`. In `src/cli/parse.ts:64-68`, read the schema from the descriptor instead of `(procedure as any)["~orpc"]`.

**Verify**: `bun run test -- parse` (existing flag-parsing tests, incl. the `--plugin-port-start 4010` case) pass unchanged; `grep -n '"~orpc"' packages/everything-dev/src` → no matches.

### Step 3: AGENTS.md command truth (DX-03)

`AGENTS.md:273`: `bos info` → `bos config` (same comment). Read the surrounding block to confirm no other nonexistent commands in the same list (verify each against `src/contract.ts` routes or `bos --help` output).

**Verify**: `grep -n "bos info" AGENTS.md` → no matches; every command named in that AGENTS.md block appears in `node packages/everything-dev/dist/cli.mjs --help`.

### Step 4: Dedupe the small stuff (ARCH-12 + ARCH-06)

1. Create `src/utils/snapshot-hash.ts` exporting the 16-char sha256 helper; import in `cli/sync.ts:71-73` and `cli/init.ts:1291-1293` (delete both inline copies). The output format must be byte-identical (same digest/substring).
2. `db/run-migrations.ts:59`: derive `DEFAULT_DUPLICATE_SQLSTATES` from `db/core.ts`'s `RETRYABLE_SQLSTATES` (or move both to one shared constant in `core.ts`) — the duplicate set is a subset of the retryable set; keep names/exports stable for existing imports.
3. NEAR: keep ONE install check (delete the Effect duplicate `checkNearCliInstalled` at `near-cli.ts:104-114` if the plain one covers its callers — check callers first; if Effect callers exist, keep the Effect one and delete the plain); extract shared `assertPrivateKey` and the gas/deposit constants (`REGISTRY_GAS = "300 Tgas"`, `ATTACHED_DEPOSIT = "0 yocto"`) into one module (e.g. extend `near-signer.ts` or a new `src/near-transaction.ts`) consumed by both signers and `near-cli.ts` args.

**Verify**: package tests pass (`near-signer`, `near-cli`, sync/init snapshot tests exist); `bun typecheck`.

### Step 5: Changeset + index

Add a changeset (dependency removal + zod-as-dependency are user-facing for published-package consumers). Update the plans-index status row.

## Test plan

- No new test files needed — every step is covered by existing tests (parse, near-signer, near-cli, sync/init snapshots). If `catalog.ts` gains the schema map, add one unit test asserting every command's map entry matches its contract schema (cheap table test in `tests/unit/parse.test.ts`).

## Done criteria

- [ ] `grep -n "@effect/platform" packages/everything-dev/package.json` → no matches
- [ ] `grep -n '"zod"' packages/everything-dev/package.json` → appears in `dependencies`
- [ ] `bun.lock` holds exactly one `@types/node` and one `vitest` version for this package
- [ ] `grep -rn '"~orpc"' packages/everything-dev/src` → no matches
- [ ] `grep -n "bos info" AGENTS.md` → no matches
- [ ] `bun typecheck`, `bun lint`, package tests, dist build, CLI smoke all green
- [ ] Changeset added

## STOP conditions

- The Node-22 `@types` pin exists because scaffolded child projects typecheck against this package on Node 22 (check `packages/everything-dev/skills/`, sync-owned tsconfigs, or CHANGELOG for a recorded reason) — if found, keep the pin, add the one-line doc note, and skip only that sub-step.
- Removing `@effect/platform*` breaks a dynamically-constructed import (string-built specifier) — `grep -rn "effect/platform" packages/everything-dev/` first; if any hit, STOP.
- The `~orpc` schema map can't be built statically for some command (lazy/schema-less route) — keep the cast for that command only, with the escape documented in the PR.

## Maintenance notes

- `src/descriptor/resolve.ts` (190 lines, exported public surface, zero in-repo consumers) — left alone pending external-consumer research (published child repos may import `everything-dev/descriptor`); next audit should grep the registry/child repos and delete or document.
- DEP-04 (`@clack/prompts` 0.10→1.8, chalk 5→6, execa 9→10) is one coordinated engines decision (`engines` bump to `>=22` if chalk 6) — schedule deliberately, not in a hygiene batch.
- Reviewer focus: Step 1.3's catalog switch and Step 2 are the only pieces with any blast radius; everything else is mechanical.
