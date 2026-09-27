# GitHub Actions Workflows

## Overview

This is a **downstream child project** — it deploys the app (UI, API, plugins) but not the host or framework packages. Those are deployed by the parent `everything.dev` repo.

This repository uses the following workflows:

- `CI` — lint, audit, typecheck, framework tests, and regression
- `Deploy` — config publish to FastKV + Railway image deploy (production, triggered directly by CI)
- `Staging` — config publish to FastKV + Railway image deploy (staging/testnet, triggered by push to `staging` branch)
- `Release` — changeset versioning and npm publish (manual only, for framework packages)
- `Docker` — Docker build and push (manual or via Release only)

The key design: `CI` is the validation workflow. On a successful push to `main`, the `Deploy` workflow triggers automatically via `workflow_run` — no dispatch token, no notify job, and it checks out the exact SHA that CI validated (`workflow_run.head_sha`). No Release or Docker in between — this is a downstream project that only deploys its own app workspaces.

`Staging` runs independently on push to the `staging` branch, deploying to testnet using `v1.citynode.testnet` as the signing account.

Host is never deployed from this repo — it's loaded from a remote URL at runtime via Module Federation.

## Workflows

### CI (`ci.yml`)

**Trigger:** Push to `main` (with `paths-ignore` for markdown and changesets) or pull requests. Also `workflow_dispatch`.

**Purpose:** Lint, typecheck, security audit, framework tests, regression, and downstream notification.

**Jobs:**
1. `detect-changes` — diffs against base to determine if `packages/everything-dev/` or `packages/every-plugin/` changed
2. `lint-and-typecheck` — install, build, audit, lint, typecheck
3. `framework-tests` — runs `everything-dev` tests (only if `everything-dev` or `every-plugin` changed)
4. `plugin-tests` — runs `every-plugin` tests (only if `every-plugin` changed)
5. `regression` — full stack regression with Playwright + Go HTTP tests (needs `lint-and-typecheck`)

**Key design decisions:**
- Generated types (`types:gen`) are produced on demand: `bun typecheck` chains `types:gen` first, `bos dev`/`bos build`/`bos publish` regenerate via `generateCodeArtifacts` — no postinstall hook exists (it was dead code under `ignore-scripts = true`).
- `detect-changes` uses native `git diff` (no third-party action). For `workflow_dispatch`, all tests run unconditionally.
- Playwright browsers are cached by `bun.lock` hash — cache hit only installs system deps (~10s), miss does full install (~60-90s).
- `cancel-in-progress: true` is safe for CI — cancelled runs never trigger Deploy (the `workflow_run` gate requires `conclusion == 'success'`).
- Skipped jobs in `needs` are non-blocking for the workflow result: `framework-tests`/`plugin-tests` may be skipped (no relevant changes) without failing CI.
- Deploy reads its config from FastKV at runtime (`BOS_ACCOUNT`/`BOS_GATEWAY` on Railway), so nothing needs to be committed back after a deploy.

### Docker (`docker.yml`)

**Trigger:** `workflow_call` from `Release`, or `workflow_dispatch`.

**Purpose:** Build and push the Docker image when a release actually publishes packages, or when manually triggered.

**Behavior:**
- Detects whether the repository has a `Dockerfile`
- Skips the build steps entirely when no Dockerfile exists
- Pushes branch and SHA tags to `ghcr.io` — no mutable `latest` pin; container tiers track the committed root `Dockerfile`

### Release (`release.yml`)

**Trigger:** `workflow_dispatch` only (manual).

**Purpose:** Consume changesets, create version PRs, and publish framework packages to npm. This is manual in downstream projects — CI no longer triggers it automatically.

**Lifecycle:**

```
1. Developer creates changeset          →  bun run changeset
2. Developer merges feature branch      →  Changesets land on main
3. CI succeeds on main                   →  workflow_run triggers Deploy directly
                                             (Release is NOT triggered automatically)
4. Developer manually triggers Release  →  Creates/updates "chore: version packages" PR
5. Team merges Version Packages PR      →  CI triggers Release again via workflow_dispatch
                                             No changesets remain (hasChangesets=false)
                                             ↓
                                             npm publish --provenance --access public
                                             ↓
                                             GitHub Releases created for each package
```

**npm publishing uses OIDC trusted publishing** — no `NPM_TOKEN` secret needed. `NODE_AUTH_TOKEN` is set to empty string, and `npm publish --provenance` authenticates via the OIDC token provisioned by `id-token: write` permission and `actions/setup-node` with `registry-url`.

### Deploy (`deploy.yml`)

**Trigger:** `workflow_run` (CI completed successfully on `main`), or `workflow_dispatch`.

**Purpose:** Build app workspaces, write deterministic bundle URLs into `bos.config.json`, publish it to FastKV, and ship the Railway image (the image stages the artifacts and serves `/bundles/*` itself).

**Behavior:**
- Runs `bos publish --deploy --packages local` (builds every locally-owned workspace)
- Checks out the exact commit CI validated (`github.event.workflow_run.head_sha`)
- Ships the Railway service with `railway up` (builds the image — the deployment artifact)
- Does **not** commit anything back — the Railway host fetches the published config from FastKV (`bos start` resolves `BOS_ACCOUNT`/`BOS_GATEWAY`), so the repo copy of `bos.config.json` is the publish *input*, not the deploy output

**Secrets:** `NEAR_PRIVATE_KEY` comes from repository secrets (FastKV config publish). `RAILWAY_TOKEN` ships the image.

**`cancel-in-progress: false`** — interrupting `bos publish --deploy` mid-flight could leave the FastKV config and the live image on different release trains. Queued deploys pick up the latest main when they run.

## Downstream Project Flow

This repo is a downstream child project. The flow is simplified — no Release or Docker in the automatic path:

```
main branch push → CI (lint, typecheck, regression)
                 → workflow_run (success) → Deploy (FastKV config publish + Railway image)

staging branch push → Staging (FastKV config publish + Railway image on testnet)
```

Release and Docker are manual-only (`workflow_dispatch`). When this repo is merged to the parent `everything.dev`, the parent's own workflows handle framework packages and host deployment.

### Staging

The `staging` branch deploys to testnet using `v1.citynode.testnet` as the signing account (configured via `staging.account` in `bos.config.json`). The `--env staging` flag on `bos publish` switches both the account and the gateway domain automatically.

**Required GitHub secrets for staging:**
- `NEAR_TESTNET_PRIVATE_KEY` — NEAR key for `v1.citynode.testnet`
- `RAILWAY_STAGING_TOKEN` — Railway token scoped to the staging environment

## Docker Image Architecture

Docker images are built in `docker.yml`. The image uses a multi-stage build:

```
Builder stage:
  COPY manifests (package.jsons, bun.lock, bunfig.toml)   # first — deps cache independently
  RUN --mount=type=cache bun install --frozen-lockfile --ignore-scripts
  COPY . .                                    # Full repo
  RUN bun run --cwd packages/every-plugin build
  RUN bun run --cwd packages/everything-dev build
  RUN bun run scripts/resolve-workspace-refs.ts  # normalize workspace refs

Regression-builder stage:
  RUN bun run scripts/regression/container-build.ts  # builds all workspaces,
                                                     # stages .bos/bundles namespace layout

Final stage:
  COPY --from=prod-builder node_modules       # Pre-installed deps
  COPY --from=prod-builder package.json bun.lock bunfig.toml
  COPY --from=prod-builder bos.config.json    # Runtime config
  COPY --from=prod-builder packages/everything-dev  # Framework CLI (bos)
  COPY --from=prod-builder packages/every-plugin    # Plugin runtime
  COPY --from=dist-builder .bos/bundles      # Image-native artifacts (BOS_BUNDLE_DIR)
```

**Why this design:**
- `packages/everything-dev` and `packages/every-plugin` are framework packages needed at runtime for the `bos` CLI and plugin runtime.
- The normalize script rewrites `workspace:*` references to concrete package versions before install.
- Workspace dists ship inside the image (`.bos/bundles/<account>/<gateway>/<workspace>/…`) and the host serves them same-origin from `/bundles/*` — the image IS the deployment (ADR 0011).
- The start command uses `bos` from `node_modules/.bin/bos`.

## npm Trusted Publishing (OIDC)

npm packages are published using **Trusted Publishing** (OpenID Connect), which eliminates the need for a long-lived `NPM_TOKEN` secret.

**How it works:**
1. The release job has `id-token: write` and `contents: write` permissions
2. `actions/setup-node` provisions Node 24 with npm 11 and configures the npm registry
3. Release staging writes normalized package manifests into `.release/`
4. `NODE_AUTH_TOKEN` is set to empty string — `npm publish --provenance` authenticates via OIDC
5. Provenance attestations link the published package to the exact commit and workflow

**Setup (already done):**
- Trusted publisher configured on npm for both `every-plugin` and `everything-dev`
- Publisher points to this repository and the `release.yml` workflow filename
- No `NPM_TOKEN` secret is needed or configured

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `NEAR_PRIVATE_KEY` | Deploy | NEAR key for FastKV config publish |
| `GITHUB_TOKEN` | Release, Check Skills | Changesets PR creation, GitHub releases, skills review PRs |

`bos publish` signs the FastKV registry transaction in-process via `near-kit` — no near-cli-rs install step is needed in CI. `NEAR_PRIVATE_KEY` (or `BOS_NEAR_PRIVATE_KEY`) is read directly from the environment; locally, `~/.near-credentials` also works.
