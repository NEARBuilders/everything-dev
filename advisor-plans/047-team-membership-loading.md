# Plan 047: Load team memberships only when the Teams tab needs them

> Follow each step and its verification gate. Do not push, merge, deploy, or modify live data. Update only this plan's status in advisor-plans/README.md when verified.

## Status
- Priority: P2
- Effort: M (about one day, including regression coverage)
- Risk: LOW — loading and cache presentation
- Depends on: 046-workspace-synchronization.md
- Category: correctness / architecture
- Planned at: `f0b65165`, 2026-09-21
- Scope: PR #136, teams and organizations only; findings introduced by this branch.

## Drift check and conventions
Run `git diff f0b65165..HEAD -- ui/src/routes/_layout/_authenticated/_dashboard/orgs/\$slug.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-teams.ts ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-teams.test.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/-teams-tab.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/-teams-tab.test.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/-team-card.tsx` and inspect `git status --short`. Compare the excerpts below to live code. Expected predecessor-plan changes are allowed; unexplained semantic drift requires stopping and reporting.
This is a Bun workspace with TypeScript, React/TanStack Query/Router, Better Auth, Drizzle PostgreSQL and Effect/oRPC. Read AGENTS.md and CONTRIBUTING.md. Before source edits load applicable intent guidance: `bunx @tanstack/intent@latest load every-plugin#plugin-development` and `every-plugin#plugin-testing` for auth/API changes; `everything-dev#ui-integration` for UI changes (use the same command prefix). Match existing kebab-case files, semantic Tailwind, typed contracts, and no implementation comments.
CONTEXT.md defines Team as “A named sub-group within an organization that shares access to the organization's feature areas.” Active Team is session state, not a new user preference. No selected team means unrestricted areas; organization owners/admins and platform admins bypass area filtering. Preserve these decisions.

## Scope
Only these paths may change:
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/$slug.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-teams.ts`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-teams.test.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-teams-tab.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-teams-tab.test.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-team-card.tsx`
- A new scoped `.changeset/*.md` for user-visible behavior.
- This plan and its status row in `advisor-plans/README.md`.

Do not modify unrelated organizations API-key behavior, node/resource ownership, framework-wide auth, dependencies, live databases, environment secrets, or unrelated advisor plans. Work in an isolated `fix/teams-047` branch/worktree if dispatched for execution. Preserve existing changes. Use semantic commits only when requested, such as `fix(auth): bind wallet invitations to their network`.

## Commands
Run from repository root. Dependencies already exist; do not reinstall or upgrade them.
- Focused verification: `bun run --cwd ui test src/routes/_layout/_authenticated/_dashboard/orgs/-organization-teams.test.tsx src/routes/_layout/_authenticated/_dashboard/orgs/-teams-tab.test.tsx` — all tests pass.
- Typecheck: `bun typecheck` — exit 0.
- Lint: `bun lint` — exit 0 (warnings may be baseline).
- Whitespace: `git diff --check` — exit 0.
- Scope: `git diff --name-only` and `git status --short` — only allowed paths.

Use Vitest via `bun run`, never Bun's built-in `bun test`. Auth integration helpers use a disposable in-memory database. Do not replace their database with a development database.

## Why this matters
Opening an organization immediately triggers a membership request for every team, even before viewing Teams. Each backend request performs three queries. The UI also represents unloaded or failed memberships as empty lists. Defer this fan-out until needed and make unknown/error states distinct from empty.

## Current state
`orgs/$slug.tsx:161` calls `useOrganizationTeams(orgId)` unconditionally. In the hook:
```ts
const memberQueries = useQueries({
  queries: teamList.map((team) => ({
    queryKey: orgTeamMembersQueryKey(team.id),
    queryFn: () => apiClient.auth.listTeamMembers({ teamId: team.id }),
  })),
});
```
The mapper uses `memberQueries[index]?.data ?? []`. The organization page passes team names into invitation targeting, so keep basic team-list loading independent of membership loading. Follow existing TeamsTab semantic components and data-testid patterns.

## Design decision
Use lazy loading rather than adding a new bulk endpoint now. The list is still needed outside Teams for invitation targeting. Enable member queries only while the Teams tab is active; retain cached results when leaving it. If organizations with many teams need further optimization, add per-expanded-card loading later based on measurements. Do not invent pagination or a new public API in this plan.

## Steps and test plan
1. Add hook/UI tests with 20 synthetic teams and mocked membership transport. Before Teams is active assert zero membership calls while team names remain available for invitation targeting. When it activates assert members load; on return with fresh cache assert no unnecessary reload. Verify focused tests initially expose eager loading.
2. Make the organization tab selection controlled using the existing Tabs interface, preserving the default tab and existing navigation behavior. Pass a membership-enabled flag to the team hook; set it only for the Teams tab. Keep hook calls unconditional and use query enabled state. Verify all focused tests pass.
3. Return explicit per-team loading/error states. Show loading text before first success; show a retry action on errors. Never show “0 members” or offer an add based on a failed/unloaded membership query. Disable only membership-dependent controls while unresolved; preserve unrelated rename/grant/delete capability. Verify loading, empty-success, error, retry-success and read-only-member cases.
4. Retain plan 046's synchronization after mutations. Assert active Teams views refetch affected member lists, hidden tabs stay deferred, and workspace refresh still occurs regardless of selected tab. Run focused tests plus common gates.

## Maintenance
The accepted request fan-out is zero membership requests outside Teams and N while Teams is displayed. This plan reduces unnecessary work; it does not claim batching. Revisit an authorized, organization-scoped bulk read only if actual team counts make active-tab fan-out costly. Do not bypass backend organization membership checks to optimize loading.


## Completion and stop rules
- [ ] Focused tests include the specified regressions and pass.
- [ ] `bun typecheck`, `bun lint`, and `git diff --check` exit 0.
- [ ] No unrelated changes, secrets, dependency changes or live data mutations.
- [ ] Update the index row to DONE only after verification; otherwise record the precise blocker.

Stop if the implementation requires out-of-scope files (apart from imports in explicitly named callers), intended identity/network semantics cannot be established, or a verification gate still fails after two reasonable repair attempts. Report pre-existing test failures separately; never label an incomplete gate as passed.

