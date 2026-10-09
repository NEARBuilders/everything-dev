# GitHub Actions Workflows

## Overview

This is the **base everything.dev runtime** — the source of truth for the published framework packages (`everything-dev`, `every-plugin`, `better-near-auth`), the universal runtime image, and the everything.dev app itself.

This repository uses the following workflows:

- `CI` — lint, audit, typecheck, framework tests, and regression
- `Deploy` — the full deploy train via `bos deploy` (build → bundle upload → FastKV publish → GHCR image push → Railway, production, triggered directly by CI)
- `Staging` — the same train against the staging env (`--env staging`, triggered by push to the `staging` branch)
- `Release` — changeset versioning and npm publish (runs on push to `main`, canonical changesets flow)

The key design: `CI` is the validation workflow. On a successful push to `main`, the `Deploy` workflow triggers automatically via `workflow_run` — no dispatch token, no notify job, and it checks out the exact SHA that CI validated (`workflow_run.head_sha`).

`Staging` runs independently on push to the `staging` branch, deploying with the config's staging env (`staging.account`/`staging.domain` in `bos.app.ts`).

## Workflows

### CI (`ci.yml`)

**Trigger:** Push to `main` (with `paths-ignore` for markdown and changesets) or pull requests. Also `workflow_dispatch`.

**Purpose:** Lint, typecheck, security audit, framework tests, regression, and downstream notification.

**Jobs:**
1. `detect-changes` — diffs against base to determine if `packages/everything-dev/` or `packages/every-plugin/` changed
2. `lint-and-typecheck` — install, build, audit, lint, typecheck
3. `framework-tests` — runs `everything-dev` tests (only if `everything-dev` or `every-plugin` changed)
4. `plugin-tests` — runs `every-plugin` tests (only if `every-plugin` changed)
5. `host-tests` — runs the host test suite (only if `host/`, `ui/`, or packages changed)
6. `regression-unit` / `regression-http` / `regression-framework` / `regression-browser` — the regression stack legs (path-gated)

**Key design decisions:**
- Generated types (`types:gen`) are produced on demand: `pnpm run typecheck` chains `types:gen` first, `bos dev`/`bos build`/`bos publish` regenerate via `generateCodeArtifacts` — no postinstall hook exists (it was dead code under `--ignore-scripts` installs).
- `detect-changes` uses native `git diff` (no third-party action). For `workflow_dispatch`, all tests run unconditionally.
- Playwright browsers are cached by `pnpm-lock.yaml` hash — cache hit only installs system deps (~10s), miss does full install (~60-90s).
- `cancel-in-progress: true` is safe for CI — cancelled runs never trigger Deploy (the `workflow_run` gate requires `conclusion == 'success'`).
- Skipped jobs in `needs` are non-blocking for the workflow result: `framework-tests`/`plugin-tests` may be skipped (no relevant changes) without failing CI.
- Deploy reads its config from FastKV at runtime (`BOS_ACCOUNT`/`BOS_GATEWAY` on Railway), so nothing needs to be committed back after a deploy.

### Release (`release.yml`)

**Trigger:** Push to `main`, or `workflow_dispatch` (manual retry).

**Purpose:** Consume changesets, create version PRs, and publish framework packages to npm.

**Lifecycle:**

```
1. Developer creates changeset          →  pnpm run changeset
2. Developer merges feature branch      →  Changesets land on main
3. CI succeeds on main                  →  workflow_run triggers Deploy directly
4. Release runs on every push to main   →  pending changesets: opens/updates
                                           the "chore: version packages" PR
5. Team merges Version Packages PR      →  no changesets remain (hasChangesets=false)
                                           ↓
                                           pnpm run release (scripts/publish-release-packages.ts)
                                           ↓
                                           npm publish --provenance --access public
                                           (rc dist-tag while .changeset/pre.json pre mode is on)
                                           ↓
                                           GitHub Releases created for each package
6. Final release after RC               →  add a changeset, `pnpm changeset pre exit`,
                                           merge the final version PR (no -rc suffix,
                                           no --prerelease flag)
```

This is the canonical [changesets/action](https://github.com/changesets/changesets) setup: the same workflow both opens the version PR (when changesets are pending) and publishes (when they are not) — merging the version PR *is* the release. The publish logic lives in `scripts/publish-release-packages.ts` via `pnpm run release`. Generated child repos use the separate template at `.github/templates/workflows/release.yml` (`workflow_run`-triggered on CI success, version-PR + workspace GitHub Releases, no npm publish).

**npm publishing uses OIDC trusted publishing** — no `NPM_TOKEN` secret needed. `NODE_AUTH_TOKEN` is set to empty string, and `npm publish --provenance` authenticates via the OIDC token provisioned by `id-token: write` permission and `actions/setup-node` with `registry-url`.

### Deploy (`deploy.yml`)

**Trigger:** `workflow_run` (CI completed successfully on `main`), or `workflow_dispatch`.

**Purpose:** Run the full deploy train with one command (`pnpm run bos deploy`): preflight (fail fast on config/signing/storage credentials before any build), staleness-checked prerequisite builds + workspace builds, bundle upload to the R2-backed storage at `cdn.everything.dev`, FastKV publish with read-back confirmation, `runtime`-stage image build pushed to GHCR by SHA + version tags (`latest` held during prereleases), and a pull-only Railway deploy pinned to the pushed digest (generated thin `FROM <image>@sha256:<digest>` Dockerfile — Railway never rebuilds, ADR 0021).

**Behavior:**
- Runs `pnpm run bos deploy` — the CLI handles every leg; missing legs (no `ci.image`, no docker, no `RAILWAY_TOKEN`) degrade gracefully with a notice
- Checks out the exact commit CI validated (`github.event.workflow_run.head_sha`)
- Keeps the mf-check retry loop and the remote smoke test as workflow-level verification
- Does **not** commit anything back — the runtime fetches the published config from FastKV (`bos start` resolves `BOS_ACCOUNT`/`BOS_GATEWAY`); the authored `bos.app.ts` is the publish *input*, not the deploy output

**Secrets:** `NEAR_PRIVATE_KEY` (FastKV config publish), `BOS_STORAGE_API_KEY` (bundle upload — mint once with `bos login --key`), `RAILWAY_TOKEN` (Railway deploy). GHCR push needs `packages: write`.

**`cancel-in-progress: false`** — interrupting the deploy mid-flight could leave the FastKV config and the live image on different release trains. Queued deploys pick up the latest main when they run.

### Staging (`staging.yml`)

**Trigger:** Push to the `staging` branch, or `workflow_dispatch`.

**Purpose:** Run the same deploy train against the staging env (`bos deploy --env staging`): account/gateway switch to the config's `staging.*` values, bundles and config publish under the staging namespace, and the Railway deploy targets the staging service (`RAILWAY_STAGING_TOKEN`).

**Required GitHub secrets for staging:**
- `RAILWAY_STAGING_TOKEN` — the staging Railway service token

## Required secrets

| Secret | Workflow | Purpose |
|--------|----------|---------|
| `NEAR_PRIVATE_KEY` | Deploy | Signs the FastKV config publish |
| `BOS_STORAGE_API_KEY` | Deploy | Bundle upload to the R2-backed storage |
| `RAILWAY_TOKEN` | Deploy | Production Railway deploy |
| `RAILWAY_STAGING_TOKEN` | Staging | Staging Railway deploy |
