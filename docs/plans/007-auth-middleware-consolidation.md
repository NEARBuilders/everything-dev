# Plan 007: Consolidate `createAuthMiddleware` — ship the current version from the template

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- plugins/_template/src/lib/auth.ts plugins/apps/src/lib/auth.ts api/src/lib/auth.ts plugins/proposals/src/lib/auth.ts plugins/votes/src/lib/auth.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: done/002-effect-bridge-dedupe.md (both rewrite the template's `lib/` — land 002 first)
- **Category**: tech-debt / security-adjacent
- **Planned at**: commit `c9ca44e1`, 2026-09-15

## Why this matters

`createAuthMiddleware` exists in two versions. The current one (in `api`, `plugins/proposals`, `plugins/votes`) is generic over org metadata, returns properly `DecoratedMiddleware`-typed middlewares, and **narrows the context it passes downstream** (`next({ context: { userId, user } })`) so handlers get non-null types on the most security-sensitive code a plugin writes. The stale one (in `plugins/_template` — the scaffold every new plugin copies — and `plugins/apps`) is `createAuthMiddleware(builder: any)` with `next: any`, no `orgMetaSchema` support, and passes the whole un-narrowed context through. Auth-check bug fixes must currently be replicated across five files, and `bos sync` actively restores the stale version into child projects.

## Current state

- Canonical (current) implementation: `api/src/lib/auth.ts` (~266 lines). Structure (lines 65-109):

```ts
export function createAuthMiddleware<TOrgMetaSchema extends z.ZodType | undefined = undefined>(
  builder: any,
  options?: { orgMetaSchema?: TOrgMetaSchema },
) {
  type TOrgMeta = OrgMetaType<TOrgMetaSchema>;
  type UserMiddleware = DecoratedMiddleware<
    AuthContext,
    { userId: string; user: RequestAuthUser },
    any, any, any
  >;
  // ... OrgMiddleware, MemberMiddleware, ApiKeyMiddleware ...
```

  It exports `{ requireAuth, requireAuthOrApiKey, requireRole, requireAdmin, requireOrganization, requireOrgRole, requireApiKey }` (check the return statement near the end of the file for the exact set). `DecoratedMiddleware` takes **5** type args on oRPC v2 (this repo migrated from 6 — verify the import site at the top of the file).
- Identical current copies: `plugins/proposals/src/lib/auth.ts:65+`, `plugins/votes/src/lib/auth.ts:65+` (diffed equal to api's).
- Stale copies: `plugins/_template/src/lib/auth.ts:20` and `plugins/apps/src/lib/auth.ts:20` — `createAuthMiddleware(builder: any)` with `next: any`, no org-meta option, un-narrowed `next({ context })`.
- Consumers of the stale copies: the plugins' own `src/index.ts` router builders (`.use(requireAuth)` etc. on their contract builders) and their `src/lib/context.ts` (`AuthContext` type). The middlewares' narrowed context changes what downstream handler code typechecks against — in the current version, handlers see `context.userId: string` (non-null) instead of optional fields.
- AGENTS.md "Common Patterns → API Middleware" documents the **current** signature with `orgMetaSchema` — the template is behind the documented API.
- Conventions: `lib/` files in `_template` carry the "BE CAREFUL MODIFYING — overwritten by bos sync" header (see `plugins/_template/src/lib/context.ts:1-6`); this repo is the sync upstream.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| _template tests | `cd plugins/_template && bun run test` | 22 pass |
| apps tests | `cd plugins/apps && bun run test` | 6 pass |
| api tests | `cd api && bun run test tests/unit/` | 66 pass |
| votes / proposals | `cd plugins/votes && bun run test` / `cd plugins/proposals && bun run test` | 1 / 10 pass |
| HTTP regression (docker test DBs: `bun run test:db:up`) | `bun run test:regression:http:dev` | all pass (auth 401/403 mapping cases included) |

## Scope

**In scope**:
- `plugins/_template/src/lib/auth.ts` (replace with the current version, adapted)
- `plugins/apps/src/lib/auth.ts` (same)
- `plugins/_template/src/index.ts`, `plugins/apps/src/index.ts` (only where handler/middleware call sites need adjusting to narrowed context types)
- Their test files if assertions reference the old shapes

**Out of scope**:
- `api/src/lib/auth.ts`, `plugins/proposals/src/lib/auth.ts`, `plugins/votes/src/lib/auth.ts` — already current; do not touch (they are the source).
- Moving the helper into every-plugin — that's part of the every-plugin/auth spike (ticket 01); this plan only converges the copies.
- Any runtime auth-behavior change beyond what the current version already does in api/proposals/votes (which is the behavior the regression suite already covers on those plugins).

## Git workflow

- Branch: `improve/007-auth-middleware-consolidation`.
- Commit style: `refactor(_template,apps)!: adopt current createAuthMiddleware (narrowed context, orgMetaSchema)`.
- Do NOT push unless instructed.

## Steps

### Step 1: Port the current version into `_template`

Copy `api/src/lib/auth.ts` over `plugins/_template/src/lib/auth.ts`, then adapt the imports to the direct-import convention the template uses (`zod`, `@orpc/server`, `effect` — the `every-plugin/orpc`, `every-plugin/zod`, `every-plugin/effect` facade barrels are deleted) and to the template's local `AuthContext` type. Verify the `AuthContext` the current version expects (from api's `lib/context.ts`) is structurally compatible with the template's; if api's version needs fields the template's `AuthContext` lacks, extend the template's `ContextSchema`/`AuthContext` to match api's (they describe the same host-provided context — check `plugins/_template/src/index.ts:36-46` docblock for the documented context fields: userId, user, apiKey, organization, near, reqHeaders, getRawBody).

**Verify**: `cd plugins/_template && bunx tsc --noEmit` (or the workspace typecheck) → exit 0.

### Step 2: Fix `_template` call sites for narrowed contexts

The current middlewares pass narrowed contexts downstream. Grep the template's router for `.use(` sites and any handler bodies reading `context.userId`/`context.user`/`context.organization` — adjust to the narrowed shapes (this typically means deleting optional-chaining/null-checks the compiler now proves unnecessary, or switching a middleware for the organization-aware variant where the handler needs org context). Do NOT weaken: if a handler needs org context, it must use `requireOrganization`/`requireOrgRole` (as api's routes do — model after `api/src/index.ts` route definitions).

**Verify**: `cd plugins/_template && bun run test` → 22 pass (tests may need the same narrowing adjustments — e.g. `things-service.test.ts` middlewares).

### Step 3: Apply to `apps`

Repeat Steps 1-2 for `plugins/apps` (its handlers use the registry routes; expect fewer call sites).

**Verify**: `cd plugins/apps && bun run test` → 6 pass; `bun typecheck` → exit 0.

### Step 4: Behavioral guard

Run the HTTP regression suite — its auth cases (`TestUnauthenticatedRouteReturnsJSONUnauthorized`, error-kind mapping 401/403) exercise the host's auth surface; the _template/app middlewares additionally surface via the template's `testError`/things routes.

**Verify**: `bun run test:regression:http:dev` → all pass.

## Test plan

- Existing suites are the guard: _template 22, apps 6 (these boot the plugins and call the routes through real middleware).
- Add one _template unit test if none exists asserting a `requireAuth`-protected route returns 401 (ORPCError UNAUTHORIZED) without a session and 200 with one — model after how `plugins/_template/tests/unit/things-service.test.ts` stubs auth context; if stubbing auth is disproportionate, an integration-style assertion in the plugin's existing test setup is acceptable.

## Done criteria

- [ ] `diff <(sed 's/every-plugin\/orpc/@orpc\/server/;s/every-plugin\/zod/zod/' plugins/_template/src/lib/auth.ts) api/src/lib/auth.ts` is empty or differs only in imports (spot-check; report the residual diff)
- [ ] `grep -n "builder: any" plugins/_template/src/lib/auth.ts plugins/apps/src/lib/auth.ts` → no matches
- [ ] `bun typecheck`, `bun lint`, all four suites, and the HTTP regression suite pass
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- The template's `AuthContext` cannot be made compatible with the current middleware's expectations without changing the host-provided context shape (that's a host contract change — out of scope).
- A handler in _template/apps genuinely requires the un-narrowed whole-context passthrough (report the route; the fix is a middleware variant, not reverting).
- api/proposals/votes copies have drifted from each other (the plan assumes they're identical — verify with `diff api/src/lib/auth.ts plugins/proposals/src/lib/auth.ts` first; drift means picking the newest and reporting).

## Maintenance notes

- Child projects receive this via `bos sync` on their next upgrade — the narrowed context is a **breaking change for their handler code** the same way it is here; the changeset should say so (`bun run changeset`, minor/major for the template sync surface).
- When ticket 01 (every-plugin/auth spike) lands, all five copies collapse into one framework export — this plan is the stepping stone that makes them identical first.
- Reviewer: scrutinize that no handler silently lost an auth requirement (a route that previously ran under the un-narrowed middleware must still `.use(...)` an appropriate middleware).
