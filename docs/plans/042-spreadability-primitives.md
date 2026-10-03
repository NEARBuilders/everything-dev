# Plan 042: Spreadability primitives — scoped deploy credentials, CI mint flow, borrowed-storage cold start

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions at the end. Update your status row in
> `docs/plans/README.md` when done.
>
> **Drift check**: `git diff --stat a7fff4671..HEAD -- packages/everything-dev/src/publish.ts packages/everything-dev/src/platform-deploy.ts packages/everything-dev/src/auth-login.ts api/src/index.ts api/src/services/storage.ts host/src/routes/api.ts host/src/program.ts`. Prerequisite: plan 029 merged (platform CDN: `POST /storage/bundles`, `/bundles/*` serving, `platformDeployEntries`). If `platformDeployEntries` is absent, STOP.

## Status

- **Priority**: P1 (Phase A); Phase B/C are direction, not scope
- **Effort**: M (Phase A — about a day incl. tests)
- **Risk**: MED — touches the publish credential path and the storage route's authz
- **Depends on**: done/029-platform-cdn (merged), plan 021's session credential model
- **Category**: architecture / direction
- **Planned at**: `a7fff4671` (feat/platform-cdn, 2026-09-23); executes after the platform-CDN PR merges

## Why this matters

The framework is a spreadability tree: everything.dev (framework site, has
tenants) → citynode.app (uses the framework, has tenants) →
chicago.citynode.app (a tenant with tenants — later, via plan 032's deployed
sandboxes). Three deployment flows must all work cleanly:

1. **Official CI publishing** — `deploy.yml` runs `bos publish --deploy` with
   `NEAR_PRIVATE_KEY` only. The platform CDN branch (029) requires an
   interactive `bos login` session for uploads — CI has none, so
   `deploy.cdn: "platform"` must not flip in bos.config.json until CI has a
   non-interactive credential. This plan closes that gap.
2. **Owner-CLI publishing** — works post-029 (login as the configured
   account). Teams need delegation: the operator mints a scoped key on the
   platform site for a teammate or CI ("mint the token to set in CI").
3. **Tenant self-deploy** — the cold-start flow: a child runtime initialized
   through the parent platform deploys its bundles to the **parent's
   storage** and runs before it owns any infrastructure; sovereignty later is
   a URL-rewrite migration, not a rearchitecture.

The design decision (operator, 2026-09-23): **the bundle path is pure
addressing; the credential carries the scope; the DAO is the endgame ACL.**

## Design decisions (record — do not relitigate in-execution)

1. **Path stays `bundles/<account>/<gateway>/<workspace>/`** — NEAR
   account-addressed, globally resolvable without consulting any platform's
   identity DB. orgId/teamId is deliberately NOT appended: a better-auth UUID
   is platform-local; embedding it breaks cross-platform addressability
   (chicago's sovereign stack cannot resolve its parent's org UUIDs). The
   org/team lives in the **credential** (which org, which capabilities, which
   account prefixes it may write).
2. **Cold start borrows the parent's storage.** A child initialized through
   everything.dev publishes its bundles to everything.dev's storage
   (`everything.dev/bundles/<child-account>/…`) and its host loads them
   cross-origin — verified safe: `program.ts:62` applies CORS to all routes,
   production allows any https origin (`security.ts` cors origin fn), script
   tags need no CORS, SRI is origin-independent.
3. **Sovereignty is a migration.** When the child stands up its own API (its
   api workspace is already in its uploaded bundles), it logs in against its
   own site; the next publish rewrites the bundle URLs to its own origin. No
   schema or protocol change.
4. **The DAO is the endgame ACL.** Tenants are DAO-owned (tenant wizard,
   plan 032 "org-owned App instance"). Phase C replaces platform-side grants
   with on-chain DAO-membership checks; platform-side grants are the interim
   trust model (same trust family as the gasless relay).

## Current state (all verified at `a7fff4671`)

- `packages/everything-dev/src/platform-deploy.ts`: `collectWorkspaceArtifacts`
  (dist/ walk), `uploadBundlesToPlatform` (`POST {site}/api/storage/bundles`,
  `x-api-key` header, 120s timeout), `platformDeployEntries` (writes
  `app|plugins.<key>.production` + integrity, and `app.ui.ssr`/`ssrIntegrity`
  from the `ssr/remoteEntry.server.js` object).
- `packages/everything-dev/src/publish.ts`: platform branch reads
  `readSessionHandle(configDir)` unconditionally — no env fallback; the
  pre-check refuses when `session.credential.accountId !== account`.
- `api/src/index.ts` `uploadBundles`: accepts session OR API key; pins uploads
  to `context.near?.primaryAccountId` when present; API-key-only uploads are
  NOT account-pinned (ADR 0015 documented limitation, bounded by the 64 MB
  ceiling + path allowlist + traversal guard).
- `host/src/program.ts` merges `context.apiKey` into the Effect context as
  `{ id, name, permissions }` (AGENTS.md MCP section) — permissions are
  already populated; the storage route does not check them.
- `plugins/auth/src/handlers/api-keys.ts` `createApiKey` passes `permissions`
  through to Better Auth's api-key plugin (`configId` defaults to
  `user-keys`/`org-keys` by organizationId).
- `packages/everything-dev/src/auth-login.ts`: `startDeviceLogin` (RFC 8628
  device flow) → claimed signed session cookie → session.json (0600).
- CI: `.github/workflows/deploy.yml` runs `bos publish --deploy` with
  `NEAR_PRIVATE_KEY`; no session can exist in CI.
- Cross-origin serving verified (see Design decision 2).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 9/9 workspaces pass |
| Lint | `bun lint` | exit 0 (warnings = baseline) |
| Framework tests | `bun run --cwd packages/everything-dev test` | all pass |
| API tests | `bun run --cwd api test tests/integration/ tests/unit/` | all pass |
| Dev smoke | `bos dev` | unchanged local behavior |

## Scope

**In scope (Phase A)**:
- `api/src/index.ts` (storage route: capability + target-scope checks)
- `packages/everything-dev/src/publish.ts` (BOS_API_KEY fallback; pre-check evolution)
- `packages/everything-dev/src/contract.ts` + `contract.meta.ts` (`bos key mint` command + metadata)
- `packages/everything-dev/src/plugin.ts` (mint handler)
- `docs/adr/0019-spreadability-identity-model.md` (create)
- `AGENTS.md` (self-deploy section: borrowed-storage cold start + CI setup)
- `.changeset/` scoped entries; this plan + README row

**Out of scope (direction, later plans)**:
- Org → account grants UI + deploy-orchestration "mint CI key" page (plan 030 extension)
- Tenant bootstrap wizard on the platform site
- DAO-membership on-chain ACL (Phase C)
- Sandbox tenant-of-tenant (plan 032), R2 materialization (plan 031 production stage)

## Steps

### Step 1: ADR 0019 — spreadability identity model

`docs/adr/0019-spreadability-identity-model.md`: the path/credential split
(decision 1), borrowed-storage cold start (2), sovereignty migration (3),
DAO endgame (4). Cross-link 0015 (file transport) and the AGENTS.md
self-deploy section. This ADR is the doc later plans cite.

**Verify**: the ADR's claims about CORS/SRI/pinning match `program.ts`,
`security.ts`, and `api/src/index.ts` as they exist at execution time.

### Step 2: Storage route authz — capability + target scope

`api/src/index.ts` `uploadBundles`, after the existing auth presence check:

- **Capability**: when `context.apiKey` is present (no session), require
  `context.apiKey.permissions` to include `"bundles:write"` (fail
  `errors.FORBIDDEN` otherwise). Session-authed requests (SIWN user) are
  exempt — a logged-in human is the full-trust case (parity with today).
- **Target scope**: API-key requests additionally validate the key's
  metadata against `input.account` — metadata (JSON) may carry
  `{ "targetAccounts": ["v1.citynode.near", …] }`; absent metadata means
  unrestricted (bounded by the account-pin rule for sessions and the
  ceilings). Fail `FORBIDDEN` when the configured account is not listed.
- Parse defensively (bad JSON metadata → treat as unrestricted, matching
  ADR 0015's not-pinned-for-API-keys limitation); unit tests for the matrix:
  session+pin, api-key+capability-ok/missing, api-key+target-in/out,
  malformed metadata.

**Verify**: `bun run --cwd api test tests/integration/ tests/unit/` green.

### Step 3: `bos key mint` — scoped credential issuance from the CLI

New subcommand (contract + meta + handler in `packages/everything-dev`):

```
bos key mint [--permissions bundles:write,registry:write] [--target <account>] [--expires-in <seconds>] [--org]
```

- Requires a stored session (device flow already stored it). Calls the auth
  plugin's `createApiKey` oRPC route with `permissions` (JSON array of
  strings) and `metadata` (`{ targetAccounts: [...] }` when `--target` is
  given), `configId` = `org-keys` (with `organizationId` resolved from the
  session's active org) or `user-keys` by default.
- Prints the key once (`edk_…`), plus the exact env line for CI:
  `BOS_API_KEY=edk_…`.
- The org→account mapping is NOT enforced by the CLI (the route's target
  scope is the enforcement point); the CLI is a convenience minter.

**Verify**: unit tests for input mapping (permissions/target/metadata) and
the printed output shape; manual smoke against `bos dev`.

### Step 4: publish — BOS_API_KEY fallback + pre-check evolution

`packages/everything-dev/src/publish.ts` platform branch:

- Credential resolution: stored session first; else `process.env.BOS_API_KEY`
  → synthesized credential `{ apiKey, siteUrl: resolved site URL, accountId:
  null }`; else the existing error (message updated to mention both paths:
  `bos login` or `BOS_API_KEY` via `bos key mint`).
- The account-match pre-check (session accountId vs configured account)
  applies to session-mode only. In API-key mode, validate client-side that
  `--target`/metadata target scope includes the configured account when the
  key metadata is locally known; otherwise pass through (the route
  enforces server-side).
- Everything downstream (uploads, `platformDeployEntries`, config write,
  FastKV publish) is unchanged — the credential shape is identical.

**Verify**: unit tests — platform + session (existing), platform +
BOS_API_KEY, platform + neither (error message mentions both paths);
`bos publish --deploy --cdn platform` dry-path remains refused without a
credential.

### Step 5: CI wiring + AGENTS.md

- `AGENTS.md` self-deploy section: add the borrowed-storage cold start (init
  through the parent platform → login on the parent → publish with the
  parent's storage → Railway boot) and the CI setup recipe (operator runs
  `bos key mint --permissions bundles:write --target <account>` once, stores
  `BOS_API_KEY` + `NEAR_PRIVATE_KEY` as CI secrets, sets
  `deploy.cdn: "platform"`).
- Note the sequencing rule in the PR/changeset: `deploy.cdn: "platform"`
  flips in bos.config.json only after CI has the `BOS_API_KEY` secret —
  flipping first breaks `deploy.yml`.
- Changeset: `everything-dev` minor (key mint + publish fallback), auth/api
  patch (route authz) as applicable.

**Verify**: review the docs render; confirm `deploy.yml` changes are NOT
included in this plan's scope (the flip is operator-run, documented).

## Test plan

- API route matrix (capability × target scope × session vs api-key) — unit.
- Publish credential resolution (session / env / neither) — unit.
- `bos key mint` input mapping + output masking (full key printed exactly
  once; subsequent logs redact).
- Existing platform-CDN publish tests stay green (credential shape unchanged).

## Done criteria

- [ ] ADR 0019 written; claims verified against live code
- [ ] Storage route enforces capability + target scope for API-key uploads; session flow unchanged
- [ ] `bos key mint` mints a scoped key and prints CI-ready env
- [ ] `BOS_API_KEY` fallback unblocks headless `bos publish --deploy --cdn platform`
- [ ] AGENTS.md documents the cold-start flow + CI recipe; sequencing rule recorded
- [ ] All gates green; changesets; README row updated

## STOP conditions

- Better Auth's api-key permissions shape turns out to be an object map (not
  a string array) — stop and record the actual shape before inventing a
  format; adapt the plan's capability check to it.
- The storage route cannot see `context.apiKey.permissions` at the host
  merge boundary — report the actual context shape; do not add a second
  auth middleware.
- CI's `deploy.yml` requires changes beyond a secret (workflow restructure)
  — out of scope; record the exact delta as a follow-up.

## Maintenance notes

- The credential shape (`{ apiKey, siteUrl, accountId }`) is the stable
  seam — plan 039 (security hardening) touches adjacent publish code
  (fail-closed SRI, URL masking): land this plan first, then rebase 039.
- Plan 041 (CLI hygiene) also rewrites `publish.ts` — same merge order.
- Phase B (org→account grants, mint-key UI on plan 030's page, tenant
  wizard) and Phase C (DAO ACL, R2) are direction only — new plans when
  Phase A lands.
- The `targetAccounts` metadata contract is the interop point for tenants:
  everything.dev's minted keys must embed the child's runtime account so the
  child's CI can publish through the parent's storage.
