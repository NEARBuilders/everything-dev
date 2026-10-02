# GitHub Actions Workflows

## Overview

This is a **downstream child project** — it deploys the app (UI, API, plugins) but not the host or framework packages. Those are deployed by the parent `everything.dev` repo.

This repository uses the following workflows:

- `CI` — lint, audit, typecheck, framework tests, and regression
- `Deploy` — the full deploy train via `bos deploy` (build → bundle upload → FastKV publish → GHCR image push → Railway, production, triggered directly by CI)
- `Staging` — the same train against testnet (`--env staging`, triggered by push to `staging` branch)
- `Release` — changeset versioning and npm publish (manual only, for framework packages)

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

**Purpose:** Run the full deploy train with one command (`bun run bos deploy`): preflight (fail fast on config/signing/storage credentials before any build), staleness-checked prerequisite builds + workspace builds, bundle upload to the R2-backed storage at `cdn.everything.dev`, FastKV publish with read-back confirmation, `runtime`-stage image build pushed to GHCR by SHA + `latest` tags, and a pull-only Railway deploy pinned to the pushed digest (generated thin `FROM <image>@sha256:<digest>` Dockerfile — Railway never rebuilds, ADR 0021).

**Behavior:**
- Runs `bun run bos deploy` — the CLI handles every leg; missing legs (no `ci.image`, no docker, no `RAILWAY_TOKEN`) degrade gracefully with a notice
- Checks out the exact commit CI validated (`github.event.workflow_run.head_sha`)
- Keeps the mf-check retry loop and the remote smoke test as workflow-level verification
- Does **not** commit anything back — the Railway host fetches the published config from FastKV (`bos start` resolves `BOS_ACCOUNT`/`BOS_GATEWAY`), so the repo copy of `bos.config.json` is the publish *input*, not the deploy output

**Secrets:** `NEAR_PRIVATE_KEY` (FastKV config publish), `BOS_STORAGE_API_KEY` (bundle upload — mint once with `bos login --key`), `RAILWAY_TOKEN` (Railway deploy). GHCR push needs `packages: write`.

**`cancel-in-progress: false`** — interrupting the deploy mid-flight could leave the FastKV config and the live image on different release trains. Queued deploys pick up the latest main when they run.

## Downstream Project Flow

This repo is a downstream child project. The flow is simplified — no Release or Docker in the automatic path:

```
main branch push → CI (lint, typecheck, regression)
                 → workflow_run (success) → Deploy (FastKV config publish + Railway image)

staging branch push → Staging (FastKV config publish + Railway image on testnet)
```

Release and Docker are manual-only (`workflow_dispatch`). When this repo is merged to the parent `everything.dev`, the parent's own workflows handle framework packages and host deployment.

### Staging

The `staging` branch deploys to testnet using `v1.citynode.testnet` as the signing account (configured via `staging.account` in `bos.config.json`). The `--env staging` flag on `bos deploy` switches both the account and the gateway domain automatically.

**Required GitHub secrets for staging:**
- `NEAR_TESTNET_PRIVATE_KEY` — NEAR key for `v1.citynode.testnet`
- `RAILWAY_STAGING_TOKEN` — Railway token scoped to the staging environment

## Docker Image Architecture

Docker images are built by the `bos deploy` CLI itself (the image leg): `docker build --target runtime` tagged with the short SHA and `latest`, pushed to `ghcr.io` (`ci.image` in `bos.config.json`, derived from `repository`). The image uses a multi-stage build:

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
| `BOS_STORAGE_API_KEY` | Deploy | Bundle upload to the R2-backed storage (mint with `bos login --key`) |
| `GITHUB_TOKEN` | Release, Check Skills | Changesets PR creation, GitHub releases, skills review PRs |

`bos publish` signs the FastKV registry transaction in-process via `near-kit` — no near-cli-rs install step is needed in CI. `NEAR_PRIVATE_KEY` (or `BOS_NEAR_PRIVATE_KEY`) is read directly from the environment; locally, `~/.near-credentials` also works.
