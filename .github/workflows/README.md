# GitHub Actions Workflows

## Overview

This repository uses four workflows: release, staging, preview, and CI. The release pipeline is the most critical — it orchestrates npm publishing, CDN deployment, and Docker image building in a single sequential job where each step gates the next.

## Workflows

### Release (`release.yml`)

**Trigger:** Push to `main` that changes `.changeset/**`, `package.json`, or the workflow file itself. Also `workflow_dispatch`.

**Purpose:** Version packages, publish to npm, deploy to Zephyr CDN, publish config to FastKV, and build/push the Docker image.

**Lifecycle:**

```
1. Developer creates changeset          →  bun run changeset
2. Developer merges feature branch      →  Changesets land on main
3. Release workflow triggers            →  changesets/action detects changesets
                                          Creates "chore: version packages" PR
                                          (bun run version bumps versions)
4. Team merges Version Packages PR      →  Release workflow triggers again
                                          No changesets remain (hasChangesets=false)
                                          ↓
                                          Build every-plugin + everything-dev
                                          ↓
                                          Stage normalized release manifests
                                          ↓
                                          npm publish (gates everything below)
                                          ↓
                                          GitHub Releases for all packages
                                          ↓
                                          bos publish --deploy (Zephyr + FastKV)
                                          ↓
                                          Commit bos.config.json [skip ci]
                                          ↓
                                          Docker build + push (multi-stage, inline)
```

**Key design decisions:**

- **npm publish gates everything.** If npm publish fails, no Zephyr deploy or Docker build happens. The `everything-dev` and `every-plugin` packages must be on npm before the Docker image can be built (the image installs them from npm, not from workspace refs).
- **Single sequential job.** All steps run in one job so that failure at any point stops the pipeline. There is no separate `publish-npm` job or `docker.yml` dispatch.
- **Normalized manifests for shipping.** Source manifests keep `workspace:*` and `workspaces.catalog` for monorepo development. Release staging, generated apps, and Docker builds normalize framework refs to concrete semver while preserving `workspaces.catalog` where appropriate.
- **Multi-stage Docker build.** The builder stage copies the full repo (including `packages/`), normalizes framework workspace refs via `scripts/resolve-workspace-refs.ts`, then runs `bun install`. The final stage copies only app code + `node_modules` — no `packages/` directory. This produces a smaller image with a clean separation between framework packages (from npm) and app code.
- **`bos start` reads config from `bos.config.json`.** The Docker start command uses `bos start --env production --no-interactive` instead of passing `--account`/`--domain` flags. Account and domain are read from the config file at runtime.

### Staging (`staging.yml`)

**Trigger:** `workflow_run` after CI completes on `main`. Also `workflow_dispatch`.

**Purpose:** Build and push a `:staging` Docker image for the staging environment.

**Behavior:** Reads the staging domain from `bos.config.json` (falls back to the production domain), builds the same multi-stage Docker image, and pushes with the `:staging` tag. Railway auto-deploys from this tag.

### Preview (`preview.yml`)

**Trigger:** `pull_request` events for comments and cleanup, plus `workflow_run` after successful PR `CI` for optional preview deploys.

**Purpose:** Comment config context on PRs, let Railway handle branch preview environments, and optionally deploy preview remotes for trusted or approved internal PRs.

**Security note:** Uses `pull_request` only (not `pull_request_target`) for PR comments. Preview deploys only run after successful `CI`, only for internal PRs, and non-version PRs are gated by the `preview` environment.

**Behavior:** On PR open/update, reads `account` and `domain` from `bos.config.json` and comments them on the PR. After `CI` succeeds for an internal PR, trusted version-package PRs automatically run `bos build --deploy`, while other internal PRs can run the same preview deploy behind the `preview` environment approval gate. Both upload the refreshed `bos.config.json` as an artifact without publishing it to FastKV.

**Note:** Railway still owns preview URLs. The GitHub workflow prepares preview remotes and artifacts, but it does not query Railway for the final preview URL.

### CI (`ci.yml`)

**Trigger:** Push to `main` or pull requests.

**Purpose:** Lint, typecheck, dependency review, and test. Also builds and pushes a `:latest` Docker image on main push.

**Security features:**
- `dependency-review-action` runs on every PR to flag known vulnerabilities
- `bun audit` fails on critical/high findings
- All actions pinned to commit SHAs
- `--ignore-scripts` on all installs

### Docker Build (`docker.yml`)

**Trigger:** `workflow_dispatch` only (manual).

**Purpose:** Manually build and push a Docker image. Not called by the release workflow (which builds inline). Exists as a safety valve for manual rebuilds.

## Docker Image Architecture

The Docker image uses a multi-stage build:

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
- The normalize script (`scripts/resolve-workspace-refs.ts`) rewrites framework `workspace:*` references to concrete package versions and updates matching `workspaces.catalog` entries before install. This happens in the builder stage only — committed manifests keep monorepo-friendly refs for local development.
- The final image is smaller because `packages/` source code (including tests, build configs, etc.) is excluded.
- The start command uses `bos` (the CLI binary from `node_modules/.bin/bos`) instead of `bun packages/everything-dev/cli.js`.

## npm Trusted Publishing (OIDC)

npm packages are published using **Trusted Publishing** (OpenID Connect), which eliminates the need for long-lived `NPM_TOKEN` secrets. Instead, GitHub Actions generates short-lived OIDC tokens that npm verifies against the configured trusted publisher.

**How it works:**
1. The release workflow provisions OIDC tokens only during the npm publish steps (not at job level — `id-token: write` is removed from job-level permissions as a security hardening measure)
2. `actions/setup-node@v6` provisions Node 24 with npm 11 support and configures the npm registry
3. Release staging writes normalized package manifests into `.release/` before publish
4. `npm publish --provenance` authenticates via OIDC using `NODE_AUTH_TOKEN` from `secrets.NPM_TOKEN`
5. Provenance attestations are automatically generated, linking the published package to the exact commit and workflow

**Setup (already done):**
- Trusted publisher configured on npm for both `every-plugin` and `everything-dev` at `https://www.npmjs.com/package/<name>/access`
- Publisher points to the repository, `release.yml` workflow filename
- `NPM_TOKEN` secret is used for `NODE_AUTH_TOKEN` during publish (scoped to publish steps only, not job-level env)

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `ZE_SECRET_TOKEN` | Release (build step) | Zephyr Cloud auth for CDN deploy |
| `ZE_SERVER_TOKEN` | Release (build step) | Zephyr Cloud server auth |
| `ZE_USER_EMAIL` | Release (build step) | Zephyr Cloud user email |
| `NEAR_PRIVATE_KEY` | Release (publish step), Publish | NEAR key for FastKV publish |
| `BOS_INSTALL_NEAR_CLI` | Release | Ensures NEAR CLI is available |
| `APP_ENV` | Docker runtime | `production` or `staging` |
| `PORT` | Docker runtime | HTTP port (default 3000) |
| `BETTER_AUTH_SECRET` | Railway | Auth encryption key |
| `BETTER_AUTH_URL` | Railway | Auth callback URL |
| `HOST_DATABASE_URL` | Railway | Host database connection |
| `HOST_DATABASE_AUTH_TOKEN` | Railway | Host database auth |
| `CORS_ORIGIN` | Railway | Allowed CORS origins |
