# Plan 030: `/deploy` orchestration page — the sandbox demo

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions below. Update your status row in
> `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 00d162cb..HEAD -- ui/src/routes packages/everything-dev/src/cli/init.ts
> packages/everything-dev/src/fastkv.ts`. Prerequisites: plans 021, 028, 029
> merged; plan 032's spike (design doc) exists — this page renders its flow
> but does not spawn sandboxes. If the descriptor (`app.ts`) flow is absent
> (plan 028), STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 028-app-ts-descriptor.md, 029-platform-cdn.md,
  032-sandbox-orchestrator-spike.md (spike/design only)
- **Category**: direction / dx
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

The operator's demo, end to end (2026-09-18 session): on the website, a
logged-in user clicks deploy, is walked through `everything-dev init` →
`bos login` → `bos publish --wallet` (CLI-prompt handoff — locked decision),
and then clicks through to their tenant running on a sandbox. Every backend
piece exists after 021/028/029: the `/cli` handshake mints credentials
(#120), gasless publish relays via NEP-366 (#120), bundles serve from the
platform (#029), configs land on FastKV. What's missing is the orchestration
page: instructions prefilled with the user's account, live publish
detection, tenant activation, and the "View tenant" handoff.

## Current state

- `/cli` page (`ui/src/routes/_layout/cli.tsx`, from #120): handshake page —
  session check → NEAR account connect → mint API key (or approve delegate
  key in `mode: "delegate"`) → POST to loopback with `state` nonce. Login
  redirect-back canonical pattern (`sanitizeRedirect`) in
  `_anon/login.tsx`.
- `everything-dev init` (`packages/everything-dev/src/cli/init.ts`):
  scaffolds child repos (minimal scaffold per advisor plan 020), writes
  `ui/src/lib/` gen files, wires extends.
- `bos login` (`#120`): loopback server on a random port; `/cli?state=…&
  port=…` handshake; `--key` mode exports a FastKV-scoped publish key.
- FastKV registry read: `packages/everything-dev/src/fastkv.ts`
  (`fetchBosConfigFromFastKv`); publish confirmation loop
  (`waitForPublishedConfig`) exists in the publish flow — the page needs
  the same read exposed over an API route.
- Tenant model: tenants are org-owned App instances (locked decision,
  2026-09-18): an org (App auth) owns an instance at `stage: "sandbox"`;
  its published config is `bos://<account>/<gateway>`; a subdomain binding
  routes visitors. Today bindings/tenant rows are created by the admin
  wizard (host BindingResolver reads `GET /tenants/bindings`, 30s cache).
- Browser-test conventions (AGENTS.md): `data-testid` for chrome —
  `<PageHeader headerTestId=…>`, interactives like `deploy.copy-command`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 8/8 workspaces pass |
| Lint | `bun lint` | exit 0 |
| UI tests | `bun run --cwd ui test` | all pass |
| API tests | `bun run --cwd api test` | all pass |
| Browser suite | regression browser tests | 25+ green |

## Scope

**In scope**:
- `ui/src/routes/_layout/_public/deploy.tsx` (create; or `_anon/` — see
  step 1)
- `api/src/contract.ts` + `index.ts` (create: config-status poll route +
  tenant-activate route)
- `tests/regression/browser/specs/deploy.spec.ts` (create)
- AGENTS.md + changeset

**Out of scope**:
- Sandbox spawning (plan 032 — the page activates a binding; the sandbox
  host rides the spike's output)
- `bos login`/`init` CLI changes (exist post-021)
- Payment/quota on tenants

## Git workflow

- Branch: `feat/deploy-orchestration`. Conventional commits:
  `feat(ui): /deploy orchestration page — init handoff + tenant activation`.

## Steps

### Step 1: The page

Public route `/deploy` (unauthenticated-friendly; prompt login when the
user proceeds to activate). Sections:
1. **Connect**: reuse the `/cli` handshake pattern — the page links to
   `bos login` instructions and, once the visitor has run it, shows the
   connected account (session + NEAR accounts via `auth.near.listAccounts`).
2. **Init**: rendered command block, prefilled from the session account:
   `everything-dev init --extends bos://v1.citynode.near/citynode.app
   --account <account>` then `bos login` then `bos publish --wallet`.
   Copy buttons with `data-testid="deploy.copy-<step>"`.
3. **Detect**: poll a new API route `GET /api/deploy/status?account=…`
   (auth'd or public-with-rate-limit — follow existing public-route
   patterns) that reads FastKV for `apps/<account>/<gateway>/bos.config.json`
   and returns `{ published: boolean, publishedAt? }`. On published →
   enable step 4. No loopback involvement — this page is the *site*, not
   the CLI.
4. **Activate + View**: button (auth'd, org-gated) calling
   `POST /api/tenants/activate` (create: tenant row + subdomain binding
   `<slug>.citynode.app` — reuse the admin wizard's binding-creation code
   path server-side; slug from org/account with collision handling). On
   success render `View your tenant → https://<slug>.citynode.app`
   (`data-testid="deploy.view-tenant"`).

**Verify**: `bun run --cwd ui test` → page tests (state machine:
disconnected → commands → published → activated); `bun run --cwd api test`
→ status + activate routes.

### Step 2: API routes

- `GET /api/deploy/status` — thin FastKV read; rate-limited; no secrets in
  response.
- `POST /api/tenants/activate` — auth'd (`requireAuth`/org middleware per
  repo patterns); idempotent per (account, gateway); returns binding URL.
  Reuses existing tenants/bindings storage — read the admin wizard's
  creation code before writing (host reads `GET /tenants/bindings`; the
  API owns the table).

**Verify**: API tests green; typecheck 0 errors.

### Step 3: Browser regression

`tests/regression/browser/specs/deploy.spec.ts`: copy-command buttons
(`deploy.copy-init`), status polling flip (fixture: pre-published account),
activate → view-tenant link. Model after existing specs
(`admin.spec.ts`, `settings-api-keys.spec.ts`).

**Verify**: browser suite green; `bun run test` green.

## Test plan

- Unit: page state machine, status route (mock FastKV), activate idempotence.
- Regression: the spec above; manual E2E: real `bos login` + `bos publish
  --wallet` from a scratch child repo → subdomain serves the tenant.

## Done criteria

- [ ] `bun typecheck` 8/8; `bun lint` clean; `bun run test` green
- [ ] Full manual demo flow green on the dev stack: site → commands →
      login → publish → published → activate → view tenant
- [ ] data-testids present (`deploy.copy-init`, `deploy.copy-login`,
      `deploy.copy-publish`, `deploy.view-tenant`); browser spec green
- [ ] README row updated

## STOP conditions

- Tenant activation requires capabilities the admin wizard guards behind
  admin-only auth (e.g. DAO-based provisioning per AGENTS.md's wizard
  notes) — report the exact guard; do not bypass.
- FastKV public reads are not exposed via any rate-limited route and adding
  one conflicts with registry auth policy — report.

## Maintenance notes

- When plan 032 lands for real, this page's step 4 becomes "View sandbox"
  pointing at the orchestrator-leased host instead of a shared-host
  subdomain — the activate contract is designed to absorb that (binding
  gains `hostMode`).
- Reviewers: no secrets in the status response; idempotent activation;
  rate limiting on public reads.
