# Plan 046: Centralize workspace refresh and invitation actions

> Follow each step and its verification gate. Do not push, merge, deploy, or modify live data. Update only this plan's status in advisor-plans/README.md when verified.

## Status
- Priority: P2
- Effort: M (about one day, including regression coverage)
- Risk: MED — session ordering and routing
- Depends on: none; coordinate with 044 if editing claim-page presentation
- Category: correctness / architecture
- Planned at: `f0b65165`, 2026-09-21
- Scope: PR #136, teams and organizations only; findings introduced by this branch.

## Drift check and conventions
Run `git diff f0b65165..HEAD -- ui/src/lib/workspace-synchronization.ts ui/src/lib/workspace-synchronization.test.ts ui/src/components/layout/use-switch-team.ts ui/src/components/layout/use-switch-organization.ts ui/src/components/layout/use-switch-organization.test.ts ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-teams.ts ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-teams.test.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/-use-invitation-actions.ts ui/src/routes/_layout/_authenticated/_dashboard/orgs/-use-invitation-actions.test.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/index.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/invites.$id.tsx tests/regression/browser/specs/team-workspace.spec.ts` and inspect `git status --short`. Compare the excerpts below to live code. Expected predecessor-plan changes are allowed; unexplained semantic drift requires stopping and reporting.
This is a Bun workspace with TypeScript, React/TanStack Query/Router, Better Auth, Drizzle PostgreSQL and Effect/oRPC. Read AGENTS.md and CONTRIBUTING.md. Before source edits load applicable intent guidance: `bunx @tanstack/intent@latest load every-plugin#plugin-development` and `every-plugin#plugin-testing` for auth/API changes; `everything-dev#ui-integration` for UI changes (use the same command prefix). Match existing kebab-case files, semantic Tailwind, typed contracts, and no implementation comments.
CONTEXT.md defines Team as “A named sub-group within an organization that shares access to the organization's feature areas.” Active Team is session state, not a new user preference. No selected team means unrestricted areas; organization owners/admins and platform admins bypass area filtering. Preserve these decisions.

## Scope
Only these paths may change:
- `ui/src/lib/workspace-synchronization.ts`
- `ui/src/lib/workspace-synchronization.test.ts`
- `ui/src/components/layout/use-switch-team.ts`
- `ui/src/components/layout/use-switch-organization.ts`
- `ui/src/components/layout/use-switch-organization.test.ts`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-teams.ts`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-teams.test.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-use-invitation-actions.ts`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-use-invitation-actions.test.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/index.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/invites.$id.tsx`
- `tests/regression/browser/specs/team-workspace.spec.ts`
- A new scoped `.changeset/*.md` for user-visible behavior.
- This plan and its status row in `advisor-plans/README.md`.

Do not modify unrelated organizations API-key behavior, node/resource ownership, framework-wide auth, dependencies, live databases, environment secrets, or unrelated advisor plans. Work in an isolated `fix/teams-046` branch/worktree if dispatched for execution. Preserve existing changes. Use semantic commits only when requested, such as `fix(auth): bind wallet invitations to their network`.

## Commands
Run from repository root. Dependencies already exist; do not reinstall or upgrade them.
- Focused verification: `bun run --cwd ui test src/lib/workspace-synchronization.test.ts src/components/layout/use-switch-organization.test.ts src/routes/_layout/_authenticated/_dashboard/orgs/-organization-teams.test.tsx src/routes/_layout/_authenticated/_dashboard/orgs/-use-invitation-actions.test.tsx` — all tests pass.
- Typecheck: `bun typecheck` — exit 0.
- Lint: `bun lint` — exit 0 (warnings may be baseline).
- Whitespace: `git diff --check` — exit 0.
- Scope: `git diff --name-only` and `git status --short` — only allowed paths.

Use Vitest via `bun run`, never Bun's built-in `bun test`. Auth integration helpers use a disposable in-memory database. Do not replace their database with a development database.

## Why this matters
The mutation caller currently needs to know how to refresh cookies, session queries, workspace queries and router state. Team edits omit part of this sequence. Invitation acceptance duplicates it in two pages. Put this behavior behind one small interface and test through its callers.

## Current state
`orgs/-organization-teams.ts:29`:
```ts
const invalidateTeams = () =>
  queryClient.invalidateQueries({ queryKey: orgTeamsQueryKey(orgId) });
```
Member invalidation similarly targets only a team-members key. AppShell independently observes `teamWorkspaceQueryKey`. In `use-switch-team.ts`, successful switching instead forces `auth.getSession({ query: { disableCookieCache: true } })`, writes `sessionQueryKey`, invalidates workspace and invalidates the router. The invitation pages repeat type dispatch plus session refresh and four query invalidations.

## Steps and test plan
1. Add hook tests following `use-switch-organization.test.ts` and `-organization-invitations.test.tsx`. Seed a real QueryClient with management and workspace data. Cover create/self-add, rename active team, delete active team, self-removal and area changes; assert observed workspace updates without focus/reload. Verify the focused command initially fails only the new missing-refresh cases.
2. Add a synchronization module accepting auth/queryClient/router dependencies. Its operation must force a current session, update session cache, invalidate affected management keys plus workspace, await refetch of active workspace observers, then re-run route guards. Hide ordering from callers. Keep the surface small: one operation with affected query keys rather than many mode flags. Verify ordering and session-refresh failure cases in its test file.
3. Adopt the operation in org/team switching and all five team management mutations. Preserve organization switch clearing active team, toasts and server error handling. A failed mutation must not report success. A committed mutation with failed refresh must surface a refresh-specific error and permit refresh without repeating the mutation. Verify focused tests pass.
4. Extract a shared invitation-action hook: dispatch email/wallet accept/reject, then synchronize successful acceptance. Both organization-list and claim-page callers supply only route-specific presentation/navigation. Preserve their distinct destinations and organization-slug fallback. Verify both recipient types, both entry points, rejection, and failed refresh in hook tests.
5. Extend the existing workspace browser spec with rename/self-membership/deletion assertions through UI. Use data-testid selectors and existing navigation conventions. When the disposable regression stack is available, run `bun run test:regression:browser:dev -- tests/regression/browser/specs/team-workspace.spec.ts`; expect all cases pass. Do not start or replace a user's running stack without an isolated test configuration. Run common gates.

## Maintenance
Future mutations affecting org role, team membership, grants or active context must call this interface. Do not implement background polling to conceal missing invalidation. Session persistence remains per session; do not add cross-device preferences.


## Completion and stop rules
- [ ] Focused tests include the specified regressions and pass.
- [ ] `bun typecheck`, `bun lint`, and `git diff --check` exit 0.
- [ ] No unrelated changes, secrets, dependency changes or live data mutations.
- [ ] Update the index row to DONE only after verification; otherwise record the precise blocker.

Stop if the implementation requires out-of-scope files (apart from imports in explicitly named callers), intended identity/network semantics cannot be established, or a verification gate still fails after two reasonable repair attempts. Report pre-existing test failures separately; never label an incomplete gate as passed.

