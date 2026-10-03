# Plan 043: Image-native artifacts — namespace-as-topology, FS-backed serving

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions at the end. Update your status row in
> `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 63b8169ad..HEAD -- host/src/routes/api.ts host/src/routes/bundles.ts scripts/regression/container-build.ts Dockerfile packages/everything-dev/src/publish.ts packages/everything-dev/src/build.ts .github/workflows/deploy.yml`. Prerequisite: plan 029 merged (the `/bundles/*` mount, CDN guards, and platform publish branch exist).

## Status

- **Priority**: P1 (Phase A executed with this plan; Phase B/C follow)
- **Effort**: S-M (Phase A), M (Phase B sunset)
- **Risk**: MED — replaces the deploy architecture; verified locally before merge
- **Depends on**: 029 (merged, #133)
- **Category**: architecture / operations / direction
- **Planned at**: post-`63b8169ad`, 2026-09-24 — supersedes plan 029's DB-backed
  bundle storage **pre-release** (nothing has shipped to npm since 2026-08-18;
  the upload machinery is deleted, not deprecated) and rescopes plan 042.

## Why this matters

The operator was stuck in a deploy loop: Zephyr fails on the dual-env ui build →
`bos publish --deploy` aborts → the `railway redeploy` step (last in
`deploy.yml`) never fires → the Dockerfile on main never ships → production
runs the 2026-08-28 image, loading September bundles with mismatched release
trains (the 502). Un-sticking the loop through Zephyr is more work than
removing Zephyr's role entirely.

The resolution: **the image IS the deployment artifact.** Every runtime ships
its own workspace dists inside its own image and serves them same-origin from
its own filesystem under its own namespace. No bundle database, no upload
credentials, no Zephyr. The published config (FastKV) is the wiring that maps
each workspace to the origin owning its namespace.

## Design decisions (record — do not relitigate in-execution)

1. **Namespace-as-topology**: `bundles/<account>/<gateway>/<workspace>/<path>`
   is served by the runtime whose image staged that account's artifacts. A
   child runtime extends the base's published config and overrides only the
   workspaces it owns, pointing them at its own origin. No shared storage.
2. **Two tiers, mode derived from bos.config.json**: all core slots local and
   no `extends` → self-contained (image stages dists, host serves them);
   anything partial or `extends` → registry tier (dists stripped, host boots
   from FastKV and loads remotes from URLs — today's prod behavior, unchanged
   for children).
3. **The DB bundle flow is deleted pre-release** — `bundle_objects`, the
   upload route, the uploader, and the session/credential requirements all go.
   App-data Postgres (auth/api data) is untouched.
4. **Integrity: v1 publishes URLs without integrity fields** —
   `applyDeployResults` deletes stale pipeline hashes. Deterministic-build SRI
   in the published config is a measured follow-up; the boot host's own
   serving does not depend on it.

## Phase A — the POC flip (shipped with this plan)

- **Host**: FS-backed `/bundles/*` serving registered ahead of the oRPC
  mount (`host/src/routes/bundles.ts`) — reads `BOS_BUNDLE_DIR` (the root
  containing `bundles/<account>/<gateway>/…`), prefix + traversal containment,
  content-type by extension, content-hashed chunks immutable / fixed-name
  entrypoints `must-revalidate`. Unset `BOS_BUNDLE_DIR` (dev stacks) falls
  through to the proxy/oRPC handlers.
- **Staging**: `container-build.ts` additionally stages the namespace layout
  to `.bos/bundles/<account>/<gateway>/…` (the regression stack's own layout
  is untouched). The Dockerfile prod runtime copies it from the
  regression-builder stage and sets `BOS_BUNDLE_DIR=/app/.bos/bundles`.
- **Publish**: the platform branch of `bos publish` writes deterministic URLs
  (`https://<domain>/bundles/<account>/<gateway>/<ws>/`, ui ssr included) —
  no session, no uploads. `deploy.cdn` defaults to `"platform"` in
  everything-dev, and bos.config.json sets it explicitly.
- **`deploy.yml`**: Zephyr env/secrets/fallback removed; order fixed —
  publish (writes URLs + FastKV) → `railway up` (builds the image, ships the
  artifacts; `railway redeploy` never rebuilds and was shipping nothing) →
  `mf check` (passes only once the new image serves `/bundles/*`).

**Phase A verification**: unit tests (bundle FS handler: content types, cache
semantics, traversal containment, unset fall-through; URL entries), typecheck
9/9, lint clean, host + framework suites green; the Deploy workflow turning
green on main is the production flip.

## Phase B — sunset (TODO)

- Delete `bundle_objects` + migration, the DB `BundleStorage`,
  `POST /api/storage/bundles`, `uploadBundlesToPlatform`, `collectWorkspaceArtifacts`
  (reused only if integrity generation lands), `platformDeployEntries`, and the
  `/api/storage/bundles` bodyLimit scoping.
- Remove Zephyr: the `withZephyr` attach points, the `BOS_CDN_PROVIDER` guard
  branches, the `"zephyr"` enum value + `deploy.cdn` field (config becomes
  implicit), zephyr deps from the catalog, zephyr build/output parsing in
  `build.ts`/`publish.ts`, `.env.example` vars.
- Rewrite the pending unreleased changesets to describe the final model.
- Optionally unify the regression stack onto the FS route (one serving path).

## Phase C — tenants (TODO)

- The break-off runbook: child repo gets the dual-mode Dockerfile via sync,
  stages its own workspaces under its own namespace, its config slice extends
  the base's published config. `bos start` registry tier unchanged.
- Sandbox tenants (plan 032): the orchestrator stages a tenant's dists into
  its host instance's FS — same route, same namespace rule.
- Plan 042 rescopes to the optional on-chain chunk manifest only; FastFS
  (BundleStorage backend swap) stays a spike, not a dependency.

## Commands

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `bun typecheck` | 9/9 |
| Lint | `bun lint` | 0 errors |
| Framework tests | `bun run --cwd packages/everything-dev test` | green |
| Host tests | `bun run --cwd host test` | green |
| Stage namespace layout | `bun run scripts/regression/container-build.ts` | `.bos/bundles/<account>/<gateway>/` populated |

## STOP conditions

- The Railway image build fails on the new stages — report the build log; do
  not ship a Dockerfile that cannot build (the operator's "dockerfile error"
  from the pre-flip era must be understood or superseded).
- `mf check` cannot pass against FS-served bundles after the redeploy —
  report; the serving or manifest layout is wrong.
- The FastKV publish rejects the config (schema/size) — report the payload.

## Maintenance notes

- `BOS_BUNDLE_DIR` unset = registry tier (children). Set = self-contained tier.
  Never point a child's `BOS_BUNDLE_DIR` at another runtime's layout.
- The `/bundles/*` FS route is the platform tier's serving path; the oRPC
  `serveBundle` route is removed in Phase B.
- The descriptor demo (`bos.app.ts` / `bos.citynode.app.ts`) is unaffected —
  `deploy.cdn` flows through the descriptor after 028.
