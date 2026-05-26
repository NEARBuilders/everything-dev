# GitHub Actions Workflows

## Overview

This repository uses the following production-facing workflows:

- `CI` — lint, audit, and typecheck
- `Docker` — Docker build and push after successful `CI` on `main`
- `Release` — changeset versioning and npm publish for framework packages
- `Publish` — app deploy (Zephyr CDN + FastKV config publish)
- `Preview` — PR preview comments via Railway

The key design: `CI` is the validation workflow. `Release`, `Publish`, and `Docker` run as standalone workflows after successful `CI` runs on `main` via `workflow_run`. Docker remains decoupled so long image builds do not delay release or publish.

## Workflows

### CI (`ci.yml`)

**Trigger:** Push to `main` (with `paths-ignore` for markdown and changesets) or pull requests. Also `workflow_dispatch`.

**Purpose:** Lint, typecheck, and security audit.

**Jobs:**
1. `lint-and-typecheck` — install, build, postinstall, audit, lint, typecheck

**Key design decisions:**
- `Build every-plugin` runs before `postinstall` in both `release.yml` and `ci.yml` because `postinstall` triggers `types:gen` which needs `every-plugin` to be built first.

### Docker (`docker.yml`)

**Trigger:** successful `workflow_run` from `CI` on `main`, or `workflow_dispatch`.

**Purpose:** Build and push the Docker image only after validation passes, without blocking `Release` or `Publish`.

**Behavior:**
- Detects whether the repository has a `Dockerfile`
- Skips the build steps entirely when no Dockerfile exists
- Pushes `latest`, branch, and SHA tags to `ghcr.io`

### Release (`release.yml`)

**Trigger:** successful `workflow_run` from `CI` on `main`, or `workflow_dispatch`.

**Purpose:** Consume changesets, create version PRs, and publish framework packages to npm.

**Lifecycle:**

```
1. Developer creates changeset          →  bun run changeset
2. Developer merges feature branch      →  Changesets land on main
3. CI succeeds on main                   →  `workflow_run` triggers Release
                                            Creates/updates "chore: version packages" PR
4. Team merges Version Packages PR      →  CI triggers Release again
                                            No changesets remain (hasChangesets=false)
                                           ↓
                                           npm publish --provenance --access public
                                           ↓
                                           GitHub Releases created for each package
```

**npm publishing uses OIDC trusted publishing** — no `NPM_TOKEN` secret needed. `NODE_AUTH_TOKEN` is set to empty string, and `npm publish --provenance` authenticates via the OIDC token provisioned by `id-token: write` permission and `actions/setup-node` with `registry-url`.

### Publish (`publish.yml`)

**Trigger:** successful `workflow_run` from `CI` on `main`, or `workflow_dispatch`.

**Purpose:** Detect whether a commit requires app deploy or just config publish, then run `bos publish` (with optional `--deploy`).

**Behavior:**
- Scans `.changeset/` files for changes to deployable packages (ui, api, host, plugins)
- Checks if `bos.config.json` changed in the commit
- If deployable changes exist: runs `bos publish --deploy` (Zephyr CDN deploy + FastKV publish)
- If only config changed (or manual dispatch): runs `bos publish` (FastKV publish only)

**Secrets:** `NEAR_PRIVATE_KEY`, `ZEPHYR_AUTH_TOKEN`, and `ZEPHYR_USER_EMAIL` come directly from repository secrets. NEAR for FastKV publish, Zephyr for CDN deploy.

### Preview (`preview.yml`)

**Trigger:** `pull_request` close events for cleanup, plus `workflow_run` after successful PR CI.

**Purpose:** Publish the Railway preview URL as a PR comment.

**Security:** Uses `workflow_run` only after successful internal PR CI, so repository secrets are not exposed to forked PRs.

**Configuration:** Set `RAILWAY_TOKEN` and `RAILWAY_PROJECT_ID` as GitHub Actions secrets. Optionally set `RAILWAY_SERVICE_NAME` as a repository variable.

## Docker Image Architecture

Docker images are built in `docker.yml`. The image uses a multi-stage build:

```
Builder stage:
  COPY . .                              # Full repo (including packages/)
  RUN bun run scripts/resolve-workspace-refs.ts   # normalize framework refs for install
  RUN bun install                       # Installs from npm + remaining workspaces

Final stage:
  COPY --from=builder node_modules      # Pre-installed deps (from npm)
  COPY --from=builder bos.config.json   # Runtime config
  COPY --from=builder package.json      # Start script
  COPY --from=builder host/ api/ ui/ plugins/  # App code only
  # packages/ is NOT copied — excluded from final image
```

**Why this design:**
- `packages/everything-dev` and `packages/every-plugin` are framework packages published to npm. The Docker image installs them from the registry, not from local source.
- The normalize script rewrites `workspace:*` references to concrete package versions before install.
- The final image excludes `packages/` source code, producing a smaller image.
- The start command uses `bos` from `node_modules/.bin/bos` instead of `bun packages/everything-dev/cli.js`.

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
| `NEAR_PRIVATE_KEY` | Publish | NEAR key for FastKV config publish |
| `ZEPHYR_AUTH_TOKEN` | Publish (as `ZE_SECRET_TOKEN`) | Zephyr Cloud auth for CDN deploy |
| `ZEPHYR_USER_EMAIL` | Publish (as `ZE_USER_EMAIL`) | Zephyr Cloud user email |
| `BOS_INSTALL_NEAR_CLI` | Release, Publish | Ensures NEAR CLI is available |
| `GITHUB_TOKEN` | Release, Publish | Changesets PR creation, GitHub releases |
