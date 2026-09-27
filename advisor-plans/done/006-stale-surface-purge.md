# Plan 006: Purge the stale public surface — dead exports, no-op codemod rewrite, dead subaccount docs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- packages/every-plugin/src/types.ts packages/every-plugin/src/errors.ts packages/every-plugin/src/testing/index.ts packages/every-plugin/src/build/rspack/index.ts packages/every-plugin/src/build/shared-deps.ts packages/everything-dev/src/cli/upgrade.ts packages/everything-dev/src/cli/init.ts packages/everything-dev/tests`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt / docs
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

Three classes of stale surface survived the Effect 4 migration: (1) every-plugin exports ~8 symbols with zero consumers (dead types, a dead composite helper, a deprecated alias kept alive only by the framework's own docs); (2) `bos upgrade` runs a full-project file scan for an import rewrite whose mapping table maps every pattern **to itself** — it can never fire; (3) every generated child `AGENTS.md` ships a subaccount workflow (full-access NEAR keys, dead `NEAR_SUB_ACCOUNT_PARENT_KEY_*` secrets) that this repo's own AGENTS.md documents as unused — fresh inits mint actively wrong security docs, and `bos sync` re-spreads them.

## Current state

**every-plugin dead exports** (all verified zero consumers repo-wide):
- `packages/every-plugin/src/build/rspack/index.ts:2,4` — re-exports `getMajorMinorVersion` and `getPluginSharedDependenciesVersionRange`; the composite `getPluginSharedDependenciesVersionRange` (`src/build/shared-deps.ts:88-94`) has no callers anywhere. (Keep `getMajorMinorVersion` itself exported from `shared-deps.ts` — it was deliberately fixed for prerelease preservation in commit `59f98792` and is a plausible standalone utility; only the dead composite + re-export go.)
- `packages/every-plugin/src/types.ts:170-172` — `PluginMetadataRegistry` (self-described "Legacy … for backwards compatibility"); `types.ts:302-309` — `LegacyPluginRuntimeConfig`; `types.ts:131` — `PluginConstructor` alias.
- `packages/every-plugin/src/errors.ts:7-16` — `ERROR_PATTERNS` (everything-dev keeps its own copy at `packages/everything-dev/src/service-descriptor.ts:37`).
- `packages/every-plugin/src/testing/index.ts:5,17,64,84` — deprecated `createLocalPluginRuntime`, alias `createTestPluginRuntime`, `PluginMap`, `InferBindingsFromMap` (all zero consumers; `PluginMap` is also 4× `any`).
- `packages/every-plugin/src/errors.ts:128-130` — deprecated `CommonPluginErrors` alias; still referenced by `packages/every-plugin/skills/plugin-development/SKILL.md:64`, `plugins/_template/src/index.ts:34` docblock, and `packages/every-plugin/tests/fixtures/test-plugin/src/contract.ts:1`. **Keep the alias for now** (published API); fix the three references to `PluginErrors` so the alias can die in the next major.

**Identity-mapping codemod** — `packages/everything-dev/src/cli/upgrade.ts:925-928`:

```ts
const LEGACY_DIST_IMPORT_REWRITES = [
  ['from "everything-dev/', 'from "everything-dev/'],
  ["from 'everything-dev/", "from 'everything-dev/"],
] as const;
```

Git history shows the source pattern was originally `from "everything-dev/dist/` (rewriting dist-subpath imports to the package root); the `/dist` was dropped from the **source** side, making every mapping an identity. `rewriteLegacyDistImports` (lines ~1149-1176) still globs every project file and runs `replaceAll` per pattern, wired into every upgrade at line ~1232.

**Dead subaccount docs** — `packages/everything-dev/src/cli/init.ts:1413-1417` (inside `buildChildAgentsInstructions`, a template string):

```
**Subaccount creation** (for the tenant wizard) requires a named NEAR account with a full access key:
1. Create a named account via near-cli-rs (implicit accounts cannot own subaccounts)
2. Export the full access key: `near account export-account <account> explicitly-provide-private-key network-config <net>`
3. Set `NEAR_SUB_ACCOUNT_PARENT_KEY_MAINNET` / `NEAR_SUB_ACCOUNT_PARENT_KEY_TESTNET` in `.env`
4. Update `bos.config.json` auth variables: `siwn.subAccount.parentAccount`, `siwn.recipients`, and `siwn.relayer.*.whitelistedContracts` → your account
```

The parent repo's `AGENTS.md` ("SIWN Auth Relayer" section) states the legacy `siwn.subAccount.parentAccount` block, `parentHasFullAccess`, `minDeposit`, and the `NEAR_SUB_ACCOUNT_PARENT_KEY_*` secrets are **unused**, and tenants are owned by a connected sputnik-dao account (the admin wizard connects via the Trezu wallet and publishes under `bos://<dao-account>/<gateway>`).

Conventions: conventional commits; test files live beside the module under `packages/everything-dev/tests/unit/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| every-plugin unit / integration | `cd packages/every-plugin && bun run test:unit` / `bun run test:integration` | 67+ / 27 pass |
| every-plugin dist | `cd packages/every-plugin && bun run build` | success |
| everything-dev tests | `cd packages/everything-dev && bun run test` | 420 pass (2 skipped) |
| everything-dev dist | `cd packages/everything-dev && bun run build` | success |

## Scope

**In scope**:
- The every-plugin files listed above (deletions + the three `CommonPluginErrors` reference fixes)
- `packages/everything-dev/src/cli/upgrade.ts` (Step 2)
- `packages/everything-dev/src/cli/init.ts` (Step 3)
- `packages/everything-dev/tests/unit/` (new/updated tests)
- `packages/every-plugin/skills/plugin-development/SKILL.md`, `plugins/_template/src/index.ts` (docblock), `packages/every-plugin/tests/fixtures/test-plugin/src/contract.ts` (import swap)

**Out of scope**:
- `packages/every-plugin/src/errors.ts:130` — the `CommonPluginErrors` alias itself stays (removal is a semver-major follow-up).
- `packages/everything-dev/src/service-descriptor.ts:37` — its local `PLUGIN_ERROR_PATTERNS` stays (working code; dedupe with every-plugin's deleted `ERROR_PATTERNS` is not worth cross-package coupling).
- `getMajorMinorVersion` in `src/build/shared-deps.ts` — stays exported from shared-deps.
- Any behavior of `bos upgrade` beyond removing the no-op rewrite.

## Git workflow

- Branch: `improve/006-stale-surface-purge`.
- Commit style: `chore(every-plugin,everything-dev)!: purge dead exports, no-op codemod rewrite, dead subaccount docs` + changeset (`bun run changeset`, minor for every-plugin/everything-dev — removals from a published package).
- Do NOT push unless instructed.

## Steps

### Step 1: Delete the dead every-plugin exports

Remove: `getPluginSharedDependenciesVersionRange` from `src/build/shared-deps.ts:88-94`; its re-export and the `getMajorMinorVersion` re-export from `src/build/rspack/index.ts:2,4` (keep the `FixMfDataUriPlugin`/`EveryPluginDevServer` exports); `PluginMetadataRegistry`, `LegacyPluginRuntimeConfig`, `PluginConstructor` from `src/types.ts`; `ERROR_PATTERNS` from `src/errors.ts:7-16`; `createLocalPluginRuntime`, `createTestPluginRuntime`, `PluginMap`, `InferBindingsFromMap` from `src/testing/index.ts`. Then fix the three `CommonPluginErrors` references (`SKILL.md:64`, `_template/src/index.ts:34` docblock, `tests/fixtures/test-plugin/src/contract.ts:1`) to use `PluginErrors`.

**Verify**: `cd packages/every-plugin && bunx tsc --noEmit -p tsconfig.json` → exit 0; `grep -rn "CommonPluginErrors" packages/every-plugin plugins/_template | grep -v "errors.ts"` → no matches; `bun run test:unit` → 67 pass (adjust if a fixture count shifts).

### Step 2: Restore the dist-import rewrite to a working pattern

In `packages/everything-dev/src/cli/upgrade.ts:925-928`, restore the source side of both mappings to the original dist-subpath form:

```ts
const LEGACY_DIST_IMPORT_REWRITES = [
  ['from "everything-dev/dist/', 'from "everything-dev/'],
  ["from 'everything-dev/dist/", "from 'everything-dev/"],
] as const;
```

(Deciding factor: the rewrite's original purpose — migrating child projects that imported `everything-dev/dist/...` subpaths — is still valid for any pre-existing child repo; deleting the function would silently strand them. Restoring the pattern keeps the upgrade path intact.) Add a fixture to `packages/everything-dev/tests/unit/upgrade-migration.test.ts` (or the upgrade test file that covers rewrites — `ls packages/everything-dev/tests/unit/ | grep upgrade`) containing a sample file with `from "everything-dev/dist/foo"` and assert it becomes `from "everything-dev/foo"`.

**Verify**: `cd packages/everything-dev && bun run test` → 420+ pass (new fixture included); `grep -n "everything-dev/dist/" packages/everything-dev/src/cli/upgrade.ts` → shows the restored source pattern.

### Step 3: Replace the dead subaccount section in generated child docs

In `packages/everything-dev/src/cli/init.ts:1413-1417`, replace the four-step subaccount block with the current tenant flow, matching the parent repo's AGENTS.md vocabulary:

```
**Tenant creation** (for the admin wizard) is DAO-owned: connect a sputnik-dao account via the Trezu wallet in the admin wizard; the wizard publishes the tenant runtime config under `bos://<dao-account>/<gateway>`. No server-side subaccount keys are needed — do not set `NEAR_SUB_ACCOUNT_PARENT_KEY_*` or `siwn.subAccount.parentAccount` (both are unused legacy).
```

Then add an assertion to the init structure tests (`ls packages/everything-dev/tests/integration/ | grep init`) that the generated AGENTS.md never contains `NEAR_SUB_ACCOUNT_PARENT_KEY`.

**Verify**: `cd packages/everything-dev && bun run test` → all pass including the new assertion.

### Step 4: Full gates + dist rebuilds + changeset

`cd packages/every-plugin && bun run build && cd ../everything-dev && bun run build`; `bun run changeset` (packages: every-plugin, everything-dev; summary: dead export removals, restored dist-import rewrite, corrected generated docs). Then full gates.

**Verify**: `bun typecheck && bun lint` → exit 0; every-plugin 67+/27; everything-dev 420+.

## Test plan

- New upgrade-migration fixture (Step 2) covering the restored `dist/` rewrite, single- and double-quote forms.
- New init test assertion (Step 3) that generated AGENTS.md excludes `NEAR_SUB_ACCOUNT_PARENT_KEY` and includes `sputnik-dao`.
- Existing suites must stay green (the deleted exports have no consumers, so nothing may break — if anything imports them, that's a STOP, not a fix-in-passing).

## Done criteria

- [ ] `grep -rn "PluginMetadataRegistry\|LegacyPluginRuntimeConfig\|InferBindingsFromMap\|createTestPluginRuntime\|createLocalPluginRuntime" packages/every-plugin/src` → no matches
- [ ] `grep -rn "getPluginSharedDependenciesVersionRange" packages/` → no matches
- [ ] `grep -rn "ERROR_PATTERNS" packages/every-plugin/src` → no matches
- [ ] `grep -rn "CommonPluginErrors" packages/every-plugin/skills plugins/_template packages/every-plugin/tests/fixtures` → no matches
- [ ] `bun typecheck`, `bun lint`, every-plugin (67+/27) and everything-dev (420+) suites pass
- [ ] Changeset file exists describing the removals
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- Any deleted symbol turns out to have a consumer (grep before deleting each one; a hit means the "dead" claim has drifted — report it).
- The restored dist-rewrite fixture fails because `rewriteLegacyDistImports` has other preconditions the plan didn't anticipate.
- The init tests' AGENTS.md fixture pipeline doesn't exercise `buildChildAgentsInstructions` (then the assertion needs a different home — find the actual generated-docs test, or report).

## Maintenance notes

- `CommonPluginErrors` (kept, now unreferenced) can be deleted in every-plugin's next major; note it in the changeset.
- When the every-plugin/db spike lands (ticket 01), revisit whether `PluginMap`-style testing types come back in a typed form.
- Reviewer: confirm no public consumer in npm-land plausibly used the deleted exports — the changeset's minor bump + removal notes are the communication channel.
