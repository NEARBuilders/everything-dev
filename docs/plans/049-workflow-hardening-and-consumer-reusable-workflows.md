# Plan 049: Workflow hardening and consumer reusable workflows

> Executor instructions: follow the steps in order, verify each gate before
> moving on, and stop if a step requires changing the child-repo contract in a
> way this plan did not call out. Update the status row for this plan in
> `docs/plans/README.md` when the work lands.

## Status

- Priority: P1
- Effort: M
- Risk: MED
- Depends on: none
- Category: ci/cd / architecture
- Planned at: commit `fa549f4f`, 2026-10-09

## Why this matters

The current workflow story has two separate problems:

1. The parent repo workflows have a few objective reliability gaps: manual
   dispatches are too permissive, staging does not match production's image
   behavior, CI path gating is stale, and `check-skills` can pass when its core
   command fails.
2. Child repos still consume synced workflow copies from
   `.github/templates/workflows/*`, so fixes have to be copied forward instead
   of reused centrally.

The architecture constraint is real: child repos may not have `packages/`,
`host/`, or a flat root where `bos.app.ts`, `ui/`, and `api/` all live at the
repository root. The reusable seam therefore cannot be directory conventions.
It has to be a command contract.

## Current state

- Parent workflows live in `.github/workflows/*` and are repo-specific.
- Child repos receive synced workflow copies from `.github/templates/workflows/*`
  via `packages/everything-dev/src/cli/sync.ts`.
- `findConfigPath()` discovers the app root by walking upward to the nearest
  `bos.app.ts` or `bos.config.json`; it does not search downward.
- ADR 0022 defines two roots: app root and workspace root. A reusable workflow
  cannot assume they are the same.
- The current child templates are already simpler than the parent workflows and
  rely on repo-root scripts like `pnpm run typecheck`, `pnpm run test`, and
  `pnpm run bos deploy`.

## Scope

In scope:

- Parent workflows in `.github/workflows/*`
- Child workflow templates in `.github/templates/workflows/*`
- Shared workflow docs in `.github/workflows/README.md`
- Sync coverage for workflow templates and framework-owned workflow files
- New reusable workflows named:
  - `.github/workflows/consumer-ci.yml`
  - `.github/workflows/consumer-deploy.yml`
  - `.github/workflows/consumer-staging.yml`

Out of scope:

- Replacing the parent repo's own CI with the consumer workflows
- Centralizing `release.yml` for child repos in this pass
- Inventing path discovery inside GitHub Actions beyond one explicit input
- Adding parent-only test jobs to child repos

## Contract decision

The consumer reusable workflows take a single path input:

- `working_directory` - the directory from which the child repo exposes its
  standard scripts

This input is intentionally not named `app_root`. The reusable workflow does not
need to know where the authored config lives, where the workspace root lives, or
whether they differ. It only needs one directory from which these commands are
valid:

- `pnpm install --frozen-lockfile --ignore-scripts`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run bos deploy`

If a child repo keeps its app under `app/` or another nested path, the child
wrapper chooses the correct `working_directory`. If a child repo wants to keep
workflow entrypoints at repository root, its own scripts bridge from the chosen
directory to the actual app root.

## Commands

Run from repository root unless a step says otherwise.

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm --filter everything-dev exec vitest run tests/integration/init.structure.test.ts tests/integration/sync.structure.test.ts tests/integration/sync.template.test.ts`
- `git diff --check`

If the reusable workflows land in this plan's implementation, also validate one
generated child fixture or smoke repo by exercising the wrapper workflows with
`working_directory: .` and one nested-path fixture before merging.

## Steps

### Step 1: Harden the parent workflows

Make the existing parent workflows correct before introducing reuse.

Changes:

- In `deploy.yml`, `release.yml`, and `staging.yml`, restrict
  `workflow_dispatch` so a manual run cannot act on an arbitrary branch by
  accident.
- In `deploy.yml`, only deploy from successful CI runs whose triggering event
  was `push`, and verify the checked-out SHA is still the current tip of
  `main` before deploying.
- In `staging.yml`, choose one explicit behavior and document it in code:
  - either match production's image leg with GHCR auth and `packages: write`
  - or explicitly skip image publishing in staging and remove any wording that
    claims parity with production
- Bring `staging.yml` back into parity with the production safety guards it is
  supposed to share, such as the bun-lock check.

Verify:

- Workflow YAML stays valid.
- `pnpm run lint` and `git diff --check` pass.

### Step 2: Fix CI path gating and skill-check failure handling

Refresh change detection so workflow and config changes exercise the right jobs.

Changes:

- In `.github/workflows/ci.yml`, replace the hardcoded references to only
  `.github/workflows/ci.yml` with patterns that cover all managed workflow
  files and workflow templates where appropriate.
- Add current canonical root files to the relevant change detectors:
  - `bos.app.ts`
  - `bos.dev.ts`
  - `tsconfig.base.json`
- In `check-skills.yml`, make `intent stale` fail loudly if the command itself
  fails or emits unusable output.
- Scope write permissions in `check-skills.yml` to only the job that actually
  opens or edits PRs.

Verify:

- `pnpm run lint`
- `pnpm run typecheck`

### Step 3: Clean up workflow naming and wording

Remove repo jargon where it obscures the actual behavior.

Changes:

- Replace `deploy train`, `build train`, `release train`, and `leg` with plain
  language like `deploy workflow`, `build pipeline`, `released artifacts`, and
  `job` or `matrix entry`.
- Expand `mf check` once to `Module Federation compatibility check
  (bos mf check)`.
- Replace `skew` with `version mismatch`.
- Remove stale README wording like `downstream notification`.
- Fix the staging secrets list in `.github/workflows/README.md` so it matches
  the actual workflow inputs.
- Rename misleading workflow job titles such as `Publish Packages` when the job
  sometimes only opens a version PR.

Verify:

- README and workflow comments describe the YAML truthfully.

### Step 4: Introduce reusable consumer workflows

Add three new reusable workflows in the parent repo:

- `.github/workflows/consumer-ci.yml`
- `.github/workflows/consumer-deploy.yml`
- `.github/workflows/consumer-staging.yml`

Design rules:

- They are child-oriented, not parent-oriented.
- They do not assume `packages/`, `host/`, or fixed directory names.
- They run only the child contract commands from `working_directory`.
- They keep secrets and environment mapping explicit.
- They do not own child trigger policy.

Initial contract:

- `consumer-ci.yml`
  - input: `working_directory` (default `.`)
  - behavior: checkout, node/pnpm setup, bun-lock guard, install, audit,
    biome, typecheck, test
- `consumer-deploy.yml`
  - inputs: `working_directory` (default `.`), `verbose` (default `false`)
  - behavior: checkout exact CI SHA, node/pnpm setup, bun-lock guard, install,
    run `pnpm run bos deploy`
- `consumer-staging.yml`
  - inputs: `working_directory` (default `.`), `verbose` (default `false`)
  - behavior: checkout target ref, node/pnpm setup, bun-lock guard, install,
    run `pnpm run bos deploy --env staging`

Non-goals for this step:

- No parent regression matrix reuse
- No parent npm release reuse
- No automatic path discovery inside the reusable workflows

Verify:

- Reusable workflows validate in GitHub syntax.
- They can be called without parent-only directories existing.

### Step 5: Convert child templates into thin wrappers

Change `.github/templates/workflows/{ci,deploy,staging}.yml` from copied logic
to thin wrappers that call the new reusable workflows.

Wrapper responsibilities:

- Own triggers
- Own repo-specific permissions
- Own environment protection rules
- Own secret mapping
- Pass `working_directory`

Central workflow responsibilities:

- Shared execution logic
- Shared guards
- Shared install / lint / deploy command sequence

Do not centralize `.github/templates/workflows/release.yml` in this pass. Keep
release policy local until the child release contract is stable enough to reuse.

Ref pinning decision (executed):

- Wrappers reference `@main`, matching the sync trust model: `bos sync`
  already tracks the parent's `main` for every framework-owned file, and the
  tarball source (`downloadTarball`) has no pinned-commit protocol to stamp
  from. The published config would need to carry the source commit for
  sync-time SHA stamping — recorded as a follow-up.
- Mitigation: `ci.yml` gains a path-gated `workflows-lint` job (actionlint,
  version-pinned via `go install`) covering `.github/workflows/**` and
  `.github/templates/workflows/**`, so a broken consumer workflow fails the
  parent's CI before children sync it.
- Prerequisite outside this repo: the parent repo's Actions settings must
  allow these workflows to be accessed from other repositories (Settings →
  Actions → General → Access).

Verify:

- `sync.template.test.ts` still proves children receive the expected wrappers.
- `sync.structure.test.ts` and `init.structure.test.ts` still pass.

### Step 6: Decide whether shared setup belongs in a composite action

Decision (executed): **deferred.** After steps 1-5 the duplicated bootstrap is
~5 steps per consumer workflow; a composite action would add an indirection
layer for that small a bundle while hiding nothing that changes often. If a
fourth consumer workflow appears (or the setup grows a prepare/patch step),
extract `checkout + node + pnpm + install + bun-guard` into a composite action
then. Do not use a composite action to hide triggers, permissions, concurrency,
or service containers. Those belong in workflows.

## Done criteria

- [x] Parent workflows are hardened against accidental manual deploy/release on
      the wrong ref (deploy/release guarded to `main`, staging to the `staging`
      branch; deploy additionally gated on fresh `push` CI runs whose commit is
      still the main tip via a `gate` job).
- [x] Staging behavior is explicit and documented: its own image namespace
      (`BOS_IMAGE: ghcr.io/nearbuilders/everything-dev-staging`), GHCR auth +
      bun guard restored; no-post-deploy-verification parity documented in the
      workflow and the workflows README.
- [x] CI path gating includes `bos.app.ts`, `bos.dev.ts`, and
      `tsconfig.base.json`; `regression-unit` broadened to all workflow files;
      new `workflows` detector feeds the `workflows-lint` job.
- [x] `check-skills` fails when its core command fails and limits write
      permissions to the PR-writing job.
- [x] Workflow wording is plain and operationally accurate (`train`/`leg`/
      `skew`/`render-mode-blind` removed from workflow files and the workflows
      README; stale "downstream notification" claim removed; staging secrets
      table completed; release job renamed to `Process Changesets`).
- [x] `consumer-ci`, `consumer-deploy`, and `consumer-staging` exist as
      reusable workflows with a `working_directory` input.
- [x] Child workflow templates (ci/deploy/staging) are thin wrappers;
      `release.yml` stays local per the plan.
- [x] `pnpm run typecheck`, `pnpm run lint`, the sync/init integration tests
      (30 tests), actionlint, and `git diff --check` all pass.

Post-merge follow-ups (tracked here, not blocking):

- Live smoke of the wrappers from a real consumer repo (flat and a nested
  `working_directory`) once the workflows exist on the pinned ref — actionlint
  plus the sync/init suites are the pre-merge coverage.
- Versioned-ref upgrade path for the wrappers (maintained tag or
  published-config commit stamping) — see the executed pinning decision above.
- AGENTS.md and the framework skills still use `deploy train`/`build train`
  phrasing; the wording pass here covered `.github/` only.
- Staging post-deploy verification parity (staging-scoped `bos mf check` /
  smoke) when staging URLs can be asserted safely.

## Stop conditions

- A child repo cannot reliably expose `typecheck`, `test`, and `bos deploy`
  from one chosen `working_directory`. If that contract does not hold, stop and
  define the missing script contract before implementing reusable workflows.
- A required child behavior depends on parent-only directories like `host/` or
  `packages/`. Stop and split parent-only logic from child-safe logic first.
- GitHub reusable workflow limitations force secrets, permissions, or
  `workflow_run` semantics that child repos cannot safely adopt. Stop and keep
  that concern local in the wrapper.

## Maintenance notes

- Parent workflows and child reusable workflows are different products. Keep
  them separate even if they share some setup steps.
- `working_directory` is the long-term seam. Do not reintroduce assumptions that
  app root, workspace root, and repository root are the same directory.
- Future child workflow reuse should prefer stable root commands over path-based
  commands.
