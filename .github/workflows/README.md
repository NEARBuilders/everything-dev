# GitHub Actions Workflows

## Overview

This repository is the base everything.dev runtime — the source of truth for the published framework packages (`everything-dev`, `every-plugin`, `better-near-auth`), the universal runtime image, and the everything.dev app itself. The reusable child-repo workflows (`consumer-*.yml`) live here too.

Workflows:

- `CI` — lint, audit, typecheck, framework tests, and the vital-plane suites (pull requests only; slow regression suites are `workflow_dispatch`-only for triage)
- `Deploy` — production deployment via `bos deploy` (build → bundle upload → FastKV publish → GHCR image push → Railway; triggered by push to `main`)
- `Staging` — the same deployment against the staging environment (`--env staging`, triggered by push to the `staging` branch)
- `Release` — changeset versioning and npm publish (triggered by push to `main`, canonical changesets flow); when a publish is imminent, the full regression matrix gates it first
- `Full regression` — reusable matrix (`regression-full.yml`): unit + dev + start + backcompat + framework regression, serially, on one runner. Consumed by the Release gate and the nightly
- `Backcompat nightly` — nightly main-tip proof: the registry sentinel plus the full regression matrix via `regression-full.yml`
- `consumer-ci` / `consumer-deploy` / `consumer-staging` — reusable workflows for generated child repos (see [Consumer workflows](#consumer-workflows))

Design: the test tiers run where a decision is made (docs/agents/testing.md) — T0 local lefthook hooks, T1 vital-plane CI on pull requests, T2 the full regression matrix before a release and nightly on the main tip. There is no `push: main` CI trigger and no merge queue. `Deploy` and `Release` trigger directly on push and gate themselves: they re-verify the commit is still the main tip (stale runs skip; the run for the new tip deploys/releases instead), and Deploy additionally verifies the commit landed as a pull request (PR provenance — a raw direct push has no associated PR and fails the gate; `workflow_dispatch` with the `force` input is the deliberate escape hatch).

The changesets version PR never runs the matrix: `detect-changes` fast-paths `changeset-release/*` PRs to an all-skipped run, so the required `CI gate` check goes green immediately (`package.json`-only diffs would otherwise trip every `detect-changes` arm). That plane is validated by release.yml instead — its regression gate runs the full matrix before any actual publish. The version PR merges via the manual merge button.

`Staging` runs independently on push to the `staging` branch, deploying with the config's staging env (`staging.account`/`staging.domain` in `bos.app.ts`).

## Workflows

### CI (`ci.yml`)

**Trigger:** Pull requests or `workflow_dispatch`. There is deliberately **no** `push: main` trigger — PR CI is the vital plane (T1 in docs/agents/testing.md); the full matrix is owned by the Release gate and the nightly (T2).

**Purpose:** Lint, typecheck, security audit, framework tests, and regression suites — folded into one required check, `CI gate`.

**Jobs:**
1. `detect-changes` — diffs against the base to gate the test jobs by changed paths (includes the authored config files `bos.app.ts`/`bos.dev.ts` and `tsconfig.base.json`)
2. `lint-and-typecheck` — install, build, audit, lint, typecheck
3. `framework-tests` — `everything-dev` tests (only if framework packages changed)
4. `plugin-tests` — `every-plugin` tests (only if `every-plugin` changed)
5. `host-tests` — host test suite (only if `host/`, `ui/`, or packages changed)
6. `regression-unit` — the regression lib's own unit tests (path-gated, ~1 min)
7. `regression-browser-smoke` — the app-load spec; ui-only PRs pay this instead of the full browser matrix
8. `regression-http` / `regression-framework` / `regression-browser` / `regression-http-start` / `regression-browser-start` — the T2 stack suites; **`workflow_dispatch`-only for triage** (the release gate and the nightly run them for real via `regression-full.yml`)
9. `regression-image` — builds the docker regression fixture once per dispatch run and exports the shared builder-stage layers to a GHCR buildcache ref the Deploy image job imports
10. `ci-gate` — the umbrella required check (`CI gate`): succeeds when every suite succeeded or was legitimately skipped by `detect-changes`, fails on any failure or cancellation. This is the only check to require on PRs — path-gated jobs cannot be required directly, because a required check never treats "skipped" as success.
11. `mirror-images` — standalone (not part of CI): weekly/dispatchable refresh of the org's GHCR base-image mirror (`mirror-node`/`mirror-postgres`/`mirror-redis`, synced from the upstream library — Docker Hub and ECR Public both rate-limit shared CI egress IPs)

**Key design decisions:**
- Generated types (`types:gen`) are produced on demand: `pnpm run typecheck` chains `types:gen` first, `bos dev`/`bos build`/`bos publish` regenerate via `generateCodeArtifacts` — no postinstall hook exists (it was dead code under `--ignore-scripts` installs).
- `detect-changes` uses native `git diff` (no third-party action). For `workflow_dispatch`, all tests run unconditionally.
- Playwright browsers are cached by `pnpm-lock.yaml` hash. System deps are probe-gated: `install-deps --dry-run` (a local `apt-get install -s` simulation — no `apt-get update`, no network) runs unconditionally, and the bounded real install only fires when a non-font package is missing. This kills the apt surface that hung three CI runs on 2026-10-23: `install-deps` used to run `apt-get update` on every job even when everything was already installed. Font packages are exempt from the gate (launch validation never checks them; the suites assert DOM text, not rendered glyphs), and a failed probe degrades to the real install. The pattern lives in the reusable composite action `.github/actions/install-playwright` — child repos (or any project) can reference it cross-repo instead of hand-copying the steps.
- Every installing job caches the pnpm store (same pattern as `consumer-ci.yml`) — cold-cache network installs only happen when the lockfile changes.
- `lint-and-typecheck` and `host-tests` cache `repos/effect` (the 61MB Effect monorepo clone `pnpm run prepare` creates), keyed on the pinned effect tag in the prepare script.
- The three `start:*` regression suites share one docker build: `regression-image` builds `--target regression` once, pushes it to `ghcr.io/<repo>:regression-ci` as a digest-pinned ref, and the start suites pull it (`REGRESSION_PREBUILT_IMAGE` → `start-container.mjs` skips the build; local runs and CI fallback build as before).
- Docker layer caching uses a GHCR registry buildcache (`ghcr.io/<repo>:buildcache`, `type=registry,mode=max`) — the gha backend's 10GB repo cap can't hold this monorepo's GB-scale node_modules layers. Note the cache-mount pnpm store *inside* the image build is never exported (BuildKit cache mounts aren't part of layer caches), so the win is the shared builder-stage layers (base, install, framework builds) — the deploy image job imports them for the same SHA CI just built.
- `cancel-in-progress: true` is safe for CI — a cancelled run reports a red `CI gate`, which PR branch protection (and nothing else) consumes.
- Skipped jobs in `needs` never break the gate: the `ci-gate` umbrella accepts `success` or `skipped` for every suite job and only fails on `failure`/`cancelled`.
- Deploy reads its config from FastKV at runtime (`BOS_ACCOUNT`/`BOS_GATEWAY` on Railway), so nothing needs to be committed back after a deploy.

### Release (`release.yml`)

**Trigger:** Push to `main`, or `workflow_dispatch` (manual retry — guarded to `main`).

**Purpose:** Consume changesets, create version PRs, and publish framework packages to npm.

**Lifecycle:**

```
1. Developer creates changeset          →  pnpm run changeset
2. Developer opens a PR                 →  CI runs the vital plane (lint,
                                           typecheck, path-gated units, the
                                           ui-only smoke on ui PRs)
3. Developer merges the PR              →  Release runs on the push to main →
                                           pending changesets: opens/updates
                                           the "chore: version packages" PR —
                                           merging that PR is the release lever
                                           (a maintainer merge button click)
4. Version Packages PR merges           →  no changesets remain
                                           ↓
                                           Full regression gate
                                           (regression-full.yml — the matrix
                                           must be green before npm sees bytes)
                                           ↓
                                           pnpm run release (scripts/publish-release-packages.ts)
                                           ↓
                                           npm publish --provenance --access public
                                           (rc dist-tag while .changeset/pre.json pre mode is on)
                                           ↓
                                           Deploy trains publish the same SHA
                                           (its preflight waits for the npm
                                           publish — see Preflight npm gate below)
5. Final release after RC               →  add a changeset, `pnpm changeset pre exit`,
                                           merge the version PR, final publish
```

This is the canonical [changesets/action](https://github.com/changesets/changesets) setup: the same workflow both opens the version PR (when changesets are pending) and publishes (when they are not) — merging the version PR *is* the release. The publish logic lives in `scripts/publish-release-packages.ts` via `pnpm run release`; it builds every publishable workspace itself before staging and publishing. Generated child repos use the separate template at `.github/templates/workflows/release.yml` (`workflow_run`-triggered on CI success, version-PR + workspace GitHub Releases, no npm publish).

**Release operations — the version PR is the release lever, merged by hand:**
- Releases ship when you merge the version PR: merging "chore: version packages" publishes npm and fires the release deploy, like any other push to `main`. The PR is created/updated by the Release workflow whenever changesets are pending.
- **Where to merge by hand:** the PR's Conversation tab (the green Merge control at the bottom).
- **Do NOT automate the merge:** auto-merge engaged with `GITHUB_TOKEN` performs the merge as `app/github-actions`, and GitHub's event-recursion guard swallows that token's push events — the rc strands silently until an unrelated merge fires the workflows (the Nov-03 stranding). A parked release is simply an unmerged version PR.
- **`cancel-in-progress: true`** on Release concurrency: the run for the newest tip supersedes (older tip-runs were already skipping), and the publish script's registry-idempotent staging heals any partially published set.

**npm publishing uses OIDC trusted publishing** — no `NPM_TOKEN` secret needed. `NODE_AUTH_TOKEN` is set to empty string, and `npm publish --provenance` authenticates via the OIDC token provisioned by `id-token: write` permission and `actions/setup-node` with `registry-url`.

**Preflight npm gate (`waitForFrameworkPackages`):** Deploy and Release trigger on the same version-bump push, and Release needs minutes to publish. Deploy's preflight used to 404 and refuse in that window; it now *waits* for the registry instead (poll every 15s, 15-min budget, cache-busted version endpoint, per-minute progress lines). The invariant is unchanged — bundles never ship ahead of npm — the refusal just fires only after the budget expires, pointing at the Release run for that SHA. A registry outage never blocks (unchanged: unverifiable state = warn and continue).

### Deploy (`deploy.yml`)

**Trigger:** Push to `main`, or `workflow_dispatch` (guarded to `main`, with `force` to skip the provenance check).

**Purpose:** Deploy in two jobs, image first. The `image` job builds the `runtime` stage and pushes it to GHCR by SHA + version tags (`latest` held during prereleases) — *before* any config or bundle publish, so a failed image push cannot leave a partially published deploy. The `deploy` job then runs `pnpm run bos deploy`: preflight (fails fast on config/signing/storage credentials before any build), staleness-checked prerequisite builds + workspace builds, bundle upload to the R2-backed storage at `cdn.everything.dev`, FastKV publish with read-back confirmation, and a pull-only Railway deploy pinned to the pre-pushed image digest (handed over as `BOS_IMAGE_DIGEST`; generated thin `FROM <image>@sha256:<digest>` Dockerfile — Railway never rebuilds, ADR 0021).

**Behavior:**
- A `gate` job first verifies the deployed commit is still the tip of `main` — if `main` moved on, this run is skipped and the run queued for the new tip deploys instead
- The gate then verifies the commit has an associated pull request (PR provenance — see the [overview](#overview)); a raw direct push fails the gate
- The `image` job is self-contained (the Dockerfile builds all workspaces from source in-image — no node/pnpm setup); it fails fast and blocks the deploy job when it cannot push the image or capture its digest
- Runs `pnpm run bos deploy` — the CLI handles every remaining stage; missing pieces (e.g. no `RAILWAY_TOKEN`) soft-skip their leg with a notice, and the deploy exits 0 whenever the config publishes and no leg failed
- Checks out the pushed commit (`github.sha`)
- Keeps the bundle compatibility check (`bos mf check`) and the remote smoke test as workflow-level verification
- Does **not** commit anything back — the runtime fetches the published config from FastKV (`bos start` resolves `BOS_ACCOUNT`/`BOS_GATEWAY`); the authored `bos.app.ts` is the publish *input*, not the deploy output

**Secrets:** `NEAR_PRIVATE_KEY` (FastKV config publish), `BOS_STORAGE_API_KEY` (bundle upload — a scoped deploy key minted once with `bos login --key`; it passes the upload service's `bundles:write` verification and is scope-checked to the authored config's account/gateway), `RAILWAY_TOKEN` (Railway deploy). GHCR push needs `packages: write` (image job only).

**`cancel-in-progress: false`** — interrupting the deploy mid-flight could leave the FastKV config and the live image from different versions. Queued deploys pick up the latest main when they run.

### Staging (`staging.yml`)

**Trigger:** Push to the `staging` branch, or `workflow_dispatch` (guarded to the `staging` branch).

**Purpose:** Run the same deployment against the staging env (`bos deploy --env staging`): account/gateway switch to the config's `staging.*` values, bundles and config publish under the staging namespace, and the Railway deploy targets the staging service (`RAILWAY_STAGING_TOKEN`).

**Differences from production (intentional):**
- The image is pushed under its own namespace — `BOS_IMAGE: ghcr.io/nearbuilders/everything-dev-staging` — so staging runs never move the production image tags
- No post-deploy verification parity yet: the bundle compatibility check and the remote smoke test assert production URLs and are production-only today

**Required GitHub secrets for staging:**
- `NEAR_TESTNET_PRIVATE_KEY` — signs the staging FastKV config publish
- `BOS_STAGING_STORAGE_API_KEY` — staging bundle upload (optional; a deploy key minted with `bos login --key --env staging` when the config's staging domain differs from the production domain — otherwise `BOS_STORAGE_API_KEY` matches both)
- `RAILWAY_STAGING_TOKEN` — the staging Railway service token

## Consumer workflows

The `consumer-*.yml` workflows are `workflow_call`-only — they never run in this repo. Generated child repos call them from thin wrapper workflows under `.github/templates/workflows/`:

- `consumer-ci.yml` — install, audit, biome, typecheck, test (from the child's standard scripts)
- `consumer-deploy.yml` — checkout the CI-validated commit, install, `pnpm run bos deploy`
- `consumer-staging.yml` — checkout the pushed commit, install, `pnpm run bos deploy --env staging`

Deploy legs are tier-aware (ADR 0020/0021): a child runtime (no `ci.image`, no Dockerfile at the config root) inherits the root's universal image, so the image and smoke legs soft-skip with a notice; the Railway leg redeploys without a digest when `RAILWAY_TOKEN` and `ci.railway.service` (inherited or set) are present, and soft-skips otherwise. The deploy exits 0 whenever the config publishes and no leg failed — `RAILWAY_TOKEN` is optional for consumers.

**Railway token scoping — children are tiered (ADR 0035 addendum):** Railway authorizes CLI verbs by token scope, so the child leg degrades cleanly by what the repo holds:
- **Publish-only** — set no railway token at all: the leg soft-skips and the deploy exits green. Nothing restarts the service, so the running deployment keeps its boot-time config until something redeploys (the #526 reconciler's job) or someone restarts manually.
- **Project-scoped `RAILWAY_TOKEN` (default)** — the leg runs a plain `redeploy --from-source` reload; the freshly published config is picked up because the runtime boots identity-driven from FastKV. When the platform pin resolves but the source wasn't repointed, the leg prints a drift notice: the service source follows the pin only under the workspace token, so after a `bos upgrade` the redeploy keeps pulling whatever ref the source points at — either opt into pin-following or repoint manually at upgrade time.
- **Workspace-scoped `RAILWAY_API_TOKEN` (opt-in advanced)** — plus the `RAILWAY_PROJECT_ID` / `RAILWAY_ENVIRONMENT_ID` repo vars: the leg repoints the service source to the platform manifest pin (`railway service source connect`, the `serviceConnect` mutation — which a project token cannot authorize) then redeploys. Note the blast radius: a workspace token can mutate any project in the workspace, so it is never the default child credential. The CLI prefers `RAILWAY_TOKEN` when both are set, so the train drops the project token when a workspace token is present.

The root runtime is unchanged and remains the advanced image-setting train — image job → digest handover → post-publish smoke → Railway pinned to the digest; it never repoints.

All three take a `working_directory` input (default `.`): the directory from which the child repo's standard scripts are valid. The workflows never assume `packages/`, `host/`, or any fixed layout — where the app root lives is the child repo's business. The deploy workflows also take a `storage_origin` input (default `https://upload.everything.dev`) — consumers self-hosting `apps/upload` point at their own service by passing the input or setting a `BOS_STORAGE_ORIGIN` repository variable, no template fork needed.

**Prerequisite:** the parent repo's Actions settings must allow these workflows to be accessed from other repositories (Settings → Actions → General → Access).

**Branch protection / required checks:** point the child repo's rule at `Lint and Type Check` — the gate job the `ci.yml` template ships after the reusable call. GitHub names reusable-workflow jobs `<caller> / <callee>` (here `CI / Lint, typecheck, and test`) and the caller cannot override the callee half, so requiring that context couples the merge gate to the upstream callee's display name: an upstream rename breaks every child's merge gate silently, with nothing notifying the children. The gate job is child-owned and slash-free, so it is immune to upstream renames. A reusable job cannot take caller jobs in `needs`, which is why the gate lives in the child's `ci.yml` rather than in `consumer-ci.yml`. Child repos that want the tiered pattern can follow the parent's: vital-plane PR CI with an umbrella required check, no `push` CI trigger, the full regression matrix gated on the release workflow and nightly, and deploy/release workflows gating on push (tip + PR provenance).

Two related caveats the template already handles:
- `paths-ignore` is deliberately absent from the `pull_request` trigger — a paths-ignored PR never runs CI, so the required check is never reported and docs-only PRs are permanently blocked once branch protection is on. `push` keeps `paths-ignore` (it gates Deploy via `workflow_run`).
- The gate uses `if: always()`: a plain `needs`-skip would report the gate as "skipped" instead of failed when the CI call fails, which some branch-protection configurations treat as non-blocking. With `always()`, a failed or skipped `ci` job fails the gate explicitly.

**Pinning:** child wrappers currently reference `@main` — the same trust model `bos sync` already applies to all framework-owned files (children track the parent's `main`, snapshot conflict detection guards local edits). Upgrading to a maintained version tag is recorded as a follow-up in `docs/plans/049-workflow-hardening-and-consumer-reusable-workflows.md`.

## Required secrets

| Secret | Workflow | Purpose |
|--------|----------|---------|
| `NEAR_PRIVATE_KEY` | Deploy | Signs the FastKV config publish |
| `NEAR_TESTNET_PRIVATE_KEY` | Staging | Signs the staging FastKV config publish |
| `BOS_STORAGE_API_KEY` | Deploy, Staging | Bundle upload to the R2-backed storage — a scoped deploy key (`bos login --key`); staging with a distinct staging domain mints its own via `--env staging` and stores it as `BOS_STAGING_STORAGE_API_KEY` |
| `RAILWAY_TOKEN` | Deploy | Production Railway deploy — optional for consumer repos: without it the Railway leg soft-skips and the deploy still exits green. Project-scoped — covers the child's `redeploy`-only default tier |
| `RAILWAY_API_TOKEN` | consumer-deploy, consumer-staging | Workspace-scoped Railway token — **opt-in** pin-following for children (the `service source connect` repoint); pair with the `RAILWAY_PROJECT_ID` / `RAILWAY_ENVIRONMENT_ID` **repo vars**. Never the default child credential (workspace-wide blast radius) |
| `RAILWAY_STAGING_TOKEN` | Staging | Staging Railway deploy — same optional-for-consumers semantics |
