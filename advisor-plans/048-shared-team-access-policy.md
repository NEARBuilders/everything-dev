# Plan 048: Share the pure team access policy between API and UI

> Follow each step and its verification gate. Do not push, merge, deploy, or modify live data. Update only this plan's status in advisor-plans/README.md when verified.

## Status
- Priority: P2
- Effort: M (about one day, including regression coverage)
- Risk: LOW — preserve policy behavior with characterization tests
- Depends on: none
- Category: correctness / architecture
- Planned at: `f0b65165`, 2026-09-21
- Scope: PR #136, teams and organizations only; findings introduced by this branch.

## Drift check and conventions
Run `git diff f0b65165..HEAD -- api/src/team-access-policy.ts api/src/feature-areas.ts api/src/lib/team-auth.ts api/package.json api/tests/unit/team-auth.test.ts api/tests/unit/team-access-policy.test.ts api/tests/integration/team-gating.test.ts ui/src/lib/team-workspace.ts ui/src/lib/team-workspace.test.ts` and inspect `git status --short`. Compare the excerpts below to live code. Expected predecessor-plan changes are allowed; unexplained semantic drift requires stopping and reporting.
This is a Bun workspace with TypeScript, React/TanStack Query/Router, Better Auth, Drizzle PostgreSQL and Effect/oRPC. Read AGENTS.md and CONTRIBUTING.md. Before source edits load applicable intent guidance: `bunx @tanstack/intent@latest load every-plugin#plugin-development` and `every-plugin#plugin-testing` for auth/API changes; `everything-dev#ui-integration` for UI changes (use the same command prefix). Match existing kebab-case files, semantic Tailwind, typed contracts, and no implementation comments.
CONTEXT.md defines Team as “A named sub-group within an organization that shares access to the organization's feature areas.” Active Team is session state, not a new user preference. No selected team means unrestricted areas; organization owners/admins and platform admins bypass area filtering. Preserve these decisions.

## Scope
Only these paths may change:
- `api/src/team-access-policy.ts`
- `api/src/feature-areas.ts`
- `api/src/lib/team-auth.ts`
- `api/package.json`
- `api/tests/unit/team-auth.test.ts`
- `api/tests/unit/team-access-policy.test.ts`
- `api/tests/integration/team-gating.test.ts`
- `ui/src/lib/team-workspace.ts`
- `ui/src/lib/team-workspace.test.ts`
- A new scoped `.changeset/*.md` for user-visible behavior.
- This plan and its status row in `advisor-plans/README.md`.

Do not modify unrelated organizations API-key behavior, node/resource ownership, framework-wide auth, dependencies, live databases, environment secrets, or unrelated advisor plans. Work in an isolated `fix/teams-048` branch/worktree if dispatched for execution. Preserve existing changes. Use semantic commits only when requested, such as `fix(auth): bind wallet invitations to their network`.

## Commands
Run from repository root. Dependencies already exist; do not reinstall or upgrade them.
- Focused verification: `bun run --cwd api test tests/unit/team-auth.test.ts tests/unit/team-access-policy.test.ts tests/integration/team-gating.test.ts` — all tests pass.
- Typecheck: `bun typecheck` — exit 0.
- Lint: `bun lint` — exit 0 (warnings may be baseline).
- Whitespace: `git diff --check` — exit 0.
- Scope: `git diff --name-only` and `git status --short` — only allowed paths.

Use Vitest via `bun run`, never Bun's built-in `bun test`. Auth integration helpers use a disposable in-memory database. Do not replace their database with a development database.

## Why this matters
API enforcement and UI navigation separately resolve Active Team and administrator bypass. One policy change can produce different authorization and navigation. A browser-safe pure module should own the common decision; middleware retains authentication/errors and the UI retains routing/rendering.

## Current state
`api/src/lib/team-auth.ts:14` checks platform admin then organization owner/admin; `resolveActiveTeam` finds a matching team ID. `ui/src/lib/team-workspace.ts:38` repeats both:
```ts
const activeTeam = teams.find((team) => team.id === activeTeamId) ?? null;
const bypass =
  context?.user?.role === "admin" || (!!orgRole && BYPASS_ORG_ROLES.includes(orgRole));
```
The existing `api/feature-areas` package export is browser-safe and imported by UI; follow that export pattern. Existing `api/tests/unit/team-auth.test.ts` invokes real oRPC middleware with `call`, which should remain the middleware test seam.

## Steps and test plan
1. Characterize a table of ordinary member with allowed/disallowed area; organization owner/admin; platform admin; no selected team; stale selected ID; missing org; unknown area. Preserve existing behavior: unknown areas never grant a known capability, no resolved team keeps area gating unrestricted, and the separate unused requireTeam middleware still requires an active team for ordinary members. Verify existing API/UI tests remain green.
2. Create `api/src/team-access-policy.ts` with a structural input independent of generated auth types. Export one resolver returning active team, bypass and known allowed areas (null means unrestricted), plus only helpers actually needed by callers. Import only browser-safe feature-area definitions. Expose it through api/package.json; no new dependency or framework package. Verify the new pure tests pass.
3. Replace duplicated calculation in API and UI with the resolver. Keep auth presence checks, organization requirements, HTTP error payloads and route prefix mapping where they are. Do not broaden server permissions based on UI inputs. Verify the focused API command and `bun run --cwd ui test src/lib/team-workspace.test.ts src/components/layout/nav-items.test.ts` pass.
4. Run common gates. Inspect the module import graph: no database, Effect, server runtime, React or generated auth imports in the shared module. Verify API and UI characterization tables exercise the same documented combinations.

## Maintenance
The Team Workspace name denotes the full UI view, not just a team record; avoid introducing another conflicting type. New roles and feature areas belong in this shared calculation, with server and UI adapter tests retained. Do not resolve the contradictory issue wording about unused requireTeam by changing behavior in this refactor.


## Completion and stop rules
- [ ] Focused tests include the specified regressions and pass.
- [ ] `bun typecheck`, `bun lint`, and `git diff --check` exit 0.
- [ ] No unrelated changes, secrets, dependency changes or live data mutations.
- [ ] Update the index row to DONE only after verification; otherwise record the precise blocker.

Stop if the implementation requires out-of-scope files (apart from imports in explicitly named callers), intended identity/network semantics cannot be established, or a verification gate still fails after two reasonable repair attempts. Report pre-existing test failures separately; never label an incomplete gate as passed.

