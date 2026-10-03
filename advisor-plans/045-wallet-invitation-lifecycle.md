# Plan 045: Make wallet invitation transitions atomic and preserve membership policy

> Follow each step and its verification gate. Do not push, merge, deploy, or modify live data. Update only this plan's status in advisor-plans/README.md when verified.

## Status
- Priority: P2
- Effort: M (about one day, including regression coverage)
- Risk: MED — transaction and session lifecycle
- Depends on: 044-wallet-invitation-network.md
- Category: correctness / architecture
- Planned at: `f0b65165`, 2026-09-21
- Scope: PR #136, teams and organizations only; findings introduced by this branch.

## Drift check and conventions
Run `git diff f0b65165..HEAD -- plugins/auth/src/near-invitations.ts plugins/auth/src/auth-instance.ts plugins/auth/src/organization-membership-policy.ts plugins/auth/tests/integration/near-invitations.test.ts plugins/auth/tests/integration/team-invitations.test.ts` and inspect `git status --short`. Compare the excerpts below to live code. Expected predecessor-plan changes are allowed; unexplained semantic drift requires stopping and reporting.
This is a Bun workspace with TypeScript, React/TanStack Query/Router, Better Auth, Drizzle PostgreSQL and Effect/oRPC. Read AGENTS.md and CONTRIBUTING.md. Before source edits load applicable intent guidance: `bunx @tanstack/intent@latest load every-plugin#plugin-development` and `every-plugin#plugin-testing` for auth/API changes; `everything-dev#ui-integration` for UI changes (use the same command prefix). Match existing kebab-case files, semantic Tailwind, typed contracts, and no implementation comments.
CONTEXT.md defines Team as “A named sub-group within an organization that shares access to the organization's feature areas.” Active Team is session state, not a new user preference. No selected team means unrestricted areas; organization owners/admins and platform admins bypass area filtering. Preserve these decisions.

## Scope
Only these paths may change:
- `plugins/auth/src/near-invitations.ts`
- `plugins/auth/src/auth-instance.ts`
- `plugins/auth/src/organization-membership-policy.ts`
- `plugins/auth/tests/integration/near-invitations.test.ts`
- `plugins/auth/tests/integration/team-invitations.test.ts`
- A new scoped `.changeset/*.md` for user-visible behavior.
- This plan and its status row in `advisor-plans/README.md`.

Do not modify unrelated organizations API-key behavior, node/resource ownership, framework-wide auth, dependencies, live databases, environment secrets, or unrelated advisor plans. Work in an isolated `fix/teams-045` branch/worktree if dispatched for execution. Preserve existing changes. Use semantic commits only when requested, such as `fix(auth): bind wallet invitations to their network`.

## Commands
Run from repository root. Dependencies already exist; do not reinstall or upgrade them.
- Focused verification: `bun run --cwd plugins/auth test tests/integration/near-invitations.test.ts tests/integration/team-invitations.test.ts` — all tests pass.
- Typecheck: `bun typecheck` — exit 0.
- Lint: `bun lint` — exit 0 (warnings may be baseline).
- Whitespace: `git diff --check` — exit 0.
- Scope: `git diff --name-only` and `git status --short` — only allowed paths.

Use Vitest via `bun run`, never Bun's built-in `bun test`. Auth integration helpers use a disposable in-memory database. Do not replace their database with a development database.

## Why this matters
Rejection can overwrite an accepted invitation because its final write does not check pending status. Wallet acceptance also writes memberships directly, skipping the ordinary Better Auth acceptance limit (100 by default). Recipient identity may vary by adapter; terminal transitions and membership policy must remain consistent.

## Current state
`near-invitations.ts:171`:
```ts
await db.update(schema.invitation)
  .set({ status: "rejected" })
  .where(eq(schema.invitation.id, invitation.id));
```
Acceptance at lines 97–149 uses a transaction and a conditional pending-to-accepted update, followed by team/member insertion. Session activation happens afterward at line 152. `auth-instance.ts:329` registers `nearInvitations(db)`. Better Auth's installed `organization/routes/crud-invites.mjs` checks `membershipLimit || 100` before ordinary acceptance. Do not modify node_modules. Follow the existing accepted transition's conditional `.returning()` idiom and APIError handling.

## Steps and test plan
1. Add a deterministic interleaving test: pause rejection after reading a pending invitation, commit acceptance, then release rejection. Assert rejection errors, final status is accepted, and exactly one membership remains. Also cover cancel winning before rejection and repeated rejection. Use a narrowly scoped spy/barrier restored after each test, not time sleeps. Verify the focused command exposes the original race.
2. Change rejection to a conditional pending transition with `.returning()`; treat zero rows as no longer pending. Keep ownership validation, and ensure acceptance continues to use guarded consumption. Verify all lifecycle tests pass. Review expiration timing; validate expiry again at the guarded transition where practical.
3. Introduce a small application-owned membership policy module exporting the configured limit and validation used by the wallet path. Pass the same explicit limit to Better Auth's organization plugin and the wallet plugin. Retain upstream email acceptance; do not replace or fork Better Auth's lifecycle. Within the wallet transaction, serialize competing wallet admissions for the same organization using a database-supported row lock before counting and inserting members. Verify two wallet invitations cannot exceed the cap. Do not claim global email/wallet concurrency serialization unless the upstream path joins the same lock.
4. Add parity cases using a small test-configured limit: both email and wallet acceptance reject a full organization; below-limit acceptance succeeds; missing team rolls back invitation/member writes; replay does not duplicate membership. Make test configuration derive from the same policy interface, not hardcoded alternate production logic. Verify the focused command passes.
5. Run all common gates. Document the existing separate session-update failure mode and verify retry reports an already-consumed invitation without duplicating membership. Do not introduce a distributed transaction or rewrite session storage for this scoped change.

## Maintenance and additional stop condition
Only share policy that the application owns. If enforcing the same configured limit requires unsupported Better Auth internals, stop and report the exact integration gap rather than patching dependencies. Verify the installed limit behavior against the lockfile on upgrades. Callback/hook parity beyond currently configured hooks is not a reason to build a general invitation framework.


## Completion and stop rules
- [ ] Focused tests include the specified regressions and pass.
- [ ] `bun typecheck`, `bun lint`, and `git diff --check` exit 0.
- [ ] No unrelated changes, secrets, dependency changes or live data mutations.
- [ ] Update the index row to DONE only after verification; otherwise record the precise blocker.

Stop if the implementation requires out-of-scope files (apart from imports in explicitly named callers), intended identity/network semantics cannot be established, or a verification gate still fails after two reasonable repair attempts. Report pre-existing test failures separately; never label an incomplete gate as passed.

