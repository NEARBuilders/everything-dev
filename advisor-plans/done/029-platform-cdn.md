# Plan 029: Platform CDN provider — `deploy.cdn: "platform"` (no-account deploys)

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions below. Update your status row in
> `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 00d162cb..HEAD -- packages/everything-dev/src/integrity.ts
> packages/everything-dev/src/publish.ts api/src/contract.ts`.
> Prerequisite: plan 021 merged (session credential + relay trust model from
> #120 exist). If `auth-login.ts`/`delegate-signer.ts` are absent, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 021-land-open-train.md
- **Category**: direction / architecture
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

The demo goal (2026-09-18 operator session): a user logs in with NEAR/social,
runs `everything-dev init` → `bos login` → `bos publish --wallet`, and the
tenant runs — **no Zephyr or Cloudflare account**. Today bundles deploy to
Zephyr (deployer's account) with a Cloudflare-R2-via-alchemy alternative
(PR #58, stale, half-deployed). The missing provider is `"platform"`:
`bos publish` uploads MF bundles to the platform API authenticated by the
session credential from `bos login` — the exact trust model the gasless
relay already uses — and the platform stores and serves them. The tenant
touches nothing but their NEAR account.

## Current state

- **Trust model (post-021)**: `packages/everything-dev/src/auth-session.ts`
  stores the session credential (`apiKey` = `edk_…`, minted by the `/cli`
  page via Better Auth `auth.apiKey.create`); the relay path
  (`/api/auth/near/relay`) authenticates it via `x-api-key` (session-for-
  API-key middleware); whitelisting + ceilings bound what a key can do.
  The bundle upload endpoint reuses this middleware family — nothing new.
- **Deploy pipeline**: `bos publish --deploy` shells workspace
  `scripts.deploy` → `withPluginDeploy` (`packages/everything-dev/src/
  integrity.ts` — no-ops unless `DEPLOY=true`, wraps Zephyr hook, computes
  SRI via `computeSriHashForUrl`, writes `production`/`integrity` fields via
  `reportDeployResult`). A platform provider must slot into exactly this
  seam: upload → get URL → SRI → report.
- **deploy config**: `deploy.cdn` does **not** exist on `main` (PR #58 was
  never merged). This plan introduces the field fresh, shaped compatibly
  with #58's design (`deploy.cdn: "zephyr" | "platform"`) and supersedes #58
  (the operator closes it separately — out of scope here).
- **API surface**: `api/src/contract.ts` (oRPC contracts + zod) and
  `api/src/index.ts` (`createRouter`) are the endpoint pattern; binary
  upload/serve may prefer a raw Hono route beside the oRPC router — check
  how existing file-ish endpoints are handled before choosing.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 8/8 workspaces pass |
| Lint | `bun lint` | exit 0 |
| API tests | `bun run --cwd api test` | all pass |
| Framework tests | `bun run --cwd packages/everything-dev test` | all pass |
| E2E | `bos publish --deploy --cdn platform` (dev stack) | bundles served from host |

## Scope

**In scope**:
- `api/src/routes/storage/**` or equivalent (create: upload + serve routes)
- `api/src/db/**` (bundle-objects table migration, if Postgres-backed)
- `api/src/contract.ts`, `api/src/index.ts` (routes)
- `packages/everything-dev/src/{publish,integrity,types}.ts` (provider
  selection + platform uploader)
- `bos.config.json` (`deploy.cdn` field, default `zephyr` — opt-in)
- Tests + changeset

**Out of scope**:
- PR #58's Cloudflare/alchemy provider (close as superseded; operator)
- Edge caching/CDN concerns; signed URLs; multi-region
- Plugin *build* changes (artifacts consumed as-is from workspace `dist/`)

## Git workflow

- Branch: `feat/platform-cdn`. Conventional commits:
  `feat(api): platform bundle storage + publish --cdn platform`.

## Steps

### Step 1: Storage endpoints (API)

- `POST /api/storage/bundles` — auth: session/API-key middleware (same as
  relay); input: JSON `{ paths: { [relativePath]: { base64OrMultipart,
  contentType } } }` or multipart; limits: total size ceiling + path
  allowlist (`remoteEntry.js`, `.js`, `.css`, `.json`, assets; reject
  traversal). Persist: dev = Postgres `bundle_objects(key, sha256, size,
  content_type, bytes)` via the API's db layer; keep the storage behind a
  tiny interface so an R2 impl drops in later (operator: platform-owned
  R2 env, NOT tenant-owned). Returns `{ base, objects: [{ key, sha256,
  integrity }] }` — SRI computed server-side over stored bytes.
- `GET /bundles/*` — public, immutable cache headers, correct
  `content-type`, serves by key
  (`bundles/<account>/<gateway>/<workspace>/<path>`).

**Verify**: `bun run --cwd api test` → new route tests (upload round-trip,
auth rejection without key, path traversal rejection, SRI correctness);
`bun typecheck` → 0 errors.

### Step 2: Uploader + provider selection (CLI)

- `packages/everything-dev/src/publish.ts`: read `deploy.cdn`
  (`"zephyr" | "platform"`; default `"zephyr"`); `platform` mode replaces
  the Zephyr deploy step with: collect workspace build artifacts (`dist/`
  per workspace — same manifest/remoteEntry contract Zephyr consumes),
  POST to the platform API (base = session credential's `siteUrl`;
  `x-api-key` auth), then write `production`/`integrity` via the existing
  `reportDeployResult` path with URLs
  `https://<site>/bundles/<account>/<gateway>/<workspace>/`.
- Extend `withPluginDeploy` (or add `withPlatformDeploy`) so workspace
  `scripts.deploy` stays a one-liner under either provider — mirror the
  ADR 0002/0003 seam (every-plugin owns lifecycle, everything-dev owns
  production).
- No session credential + `cdn: platform` → clear error: `bos login` first.

**Verify**: `bun run --cwd packages/everything-dev test` → provider
selection + uploader unit tests (mock HTTP); CLI refuses without session.

### Step 3: E2E on the dev stack

Dev stack with `cdn: "platform"`: `bos publish --deploy` uploads; host
(`bos.config.json` plugin urls now point at `/bundles/...`) loads plugins +
ui from the platform storage; verify a full page render and plugin RPC
through the served artifacts; `bos mf check` green (manifests served
alongside).

**Verify**: regression suites (HTTP + browser) green against the dev stack;
changeset written.

## Test plan

- API: upload/serve round-trip, auth, limits, traversal, SRI (fixtures with
  known bytes).
- CLI: provider selection matrix (zephyr default, platform opt-in, missing
  session → error), URL writing via `reportDeployResult` (pattern: existing
  integrity tests).
- E2E: publish → serve → load sequence on the dev stack.

## Done criteria

- [ ] `bun typecheck` 8/8; `bun lint` clean; `bun run test` green
- [ ] E2E publish+serve works on the dev stack without any external account
- [ ] `bos mf check` green against platform-served manifests
- [ ] `deploy.cdn` documented (AGENTS.md); changeset written; README row updated

## STOP conditions

- The session-for-API-key middleware cannot authorize bulk uploads within
  the existing relay-ceiling patterns — report; do not invent a new trust
  mechanism.
- Binary transport through the oRPC contract layer is impractical (size
  limits) and the Hono-side route alternative diverges from repo patterns —
  report the chosen seam before building large.

## Maintenance notes

- Plan 032 (sandbox) stores tenant *config* in FastKV and *bundles* here —
  the `/bundles/<account>/<gateway>/` key layout is the contract between
  them; keep it stable.
- R2 implementation slot: the storage interface in step 1; platform-owned
  credentials only (never tenant-visible) — revisit alongside plan 031's
  alchemy materializer.
- Reviewers: path traversal guard, size ceilings, SRI over stored bytes
  (not client-claimed hashes).
