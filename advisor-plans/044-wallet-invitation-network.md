# Plan 044: Bind wallet invitations to network identity

> Follow each step and its verification gate. Do not push, merge, deploy, or modify live data. Update only this plan's status in advisor-plans/README.md when verified.

## Status
- Priority: P1
- Effort: M (about one day, including regression coverage)
- Risk: MED — invitation schema and legacy records
- Depends on: none
- Category: correctness / architecture
- Planned at: `f0b65165`, 2026-09-21
- Scope: PR #136, teams and organizations only; findings introduced by this branch.

## Drift check and conventions
Run `git diff f0b65165..HEAD -- plugins/auth/src/near-invitations.ts plugins/auth/src/auth-instance.ts plugins/auth/src/contract.ts plugins/auth/src/handlers/invitations.ts plugins/auth/src/db/schema.ts plugins/auth/src/db/migrations plugins/auth/tests/integration/near-invitations.test.ts ui/src/routes/_layout/_authenticated/_dashboard/orgs/-invite-member-form.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/-invite-member-form.test.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-invitations.ts ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-invitations.test.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/-invitation-card.tsx ui/src/routes/_layout/_authenticated/_dashboard/orgs/invites.$id.tsx` and inspect `git status --short`. Compare the excerpts below to live code. Expected predecessor-plan changes are allowed; unexplained semantic drift requires stopping and reporting.
This is a Bun workspace with TypeScript, React/TanStack Query/Router, Better Auth, Drizzle PostgreSQL and Effect/oRPC. Read AGENTS.md and CONTRIBUTING.md. Before source edits load applicable intent guidance: `bunx @tanstack/intent@latest load every-plugin#plugin-development` and `every-plugin#plugin-testing` for auth/API changes; `everything-dev#ui-integration` for UI changes (use the same command prefix). Match existing kebab-case files, semantic Tailwind, typed contracts, and no implementation comments.
CONTEXT.md defines Team as “A named sub-group within an organization that shares access to the organization's feature areas.” Active Team is session state, not a new user preference. No selected team means unrestricted areas; organization owners/admins and platform admins bypass area filtering. Preserve these decisions.

## Scope
Only these paths may change:
- `plugins/auth/src/near-invitations.ts`
- `plugins/auth/src/auth-instance.ts`
- `plugins/auth/src/contract.ts`
- `plugins/auth/src/handlers/invitations.ts`
- `plugins/auth/src/db/schema.ts`
- `plugins/auth/src/db/migrations`
- `plugins/auth/tests/integration/near-invitations.test.ts`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-invite-member-form.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-invite-member-form.test.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-invitations.ts`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-organization-invitations.test.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/-invitation-card.tsx`
- `ui/src/routes/_layout/_authenticated/_dashboard/orgs/invites.$id.tsx`
- A new scoped `.changeset/*.md` for user-visible behavior.
- This plan and its status row in `advisor-plans/README.md`.

Do not modify unrelated organizations API-key behavior, node/resource ownership, framework-wide auth, dependencies, live databases, environment secrets, or unrelated advisor plans. Work in an isolated `fix/teams-044` branch/worktree if dispatched for execution. Preserve existing changes. Use semantic commits only when requested, such as `fix(auth): bind wallet invitations to their network`.

## Commands
Run from repository root. Dependencies already exist; do not reinstall or upgrade them.
- Focused verification: `bun run --cwd plugins/auth test tests/integration/near-invitations.test.ts` — all tests pass.
- Typecheck: `bun typecheck` — exit 0.
- Lint: `bun lint` — exit 0 (warnings may be baseline).
- Whitespace: `git diff --check` — exit 0.
- Scope: `git diff --name-only` and `git status --short` — only allowed paths.

Use Vitest via `bun run`, never Bun's built-in `bun test`. Auth integration helpers use a disposable in-memory database. Do not replace their database with a development database.

## Why this matters
Invitation discovery and acceptance currently discard the network of a linked NEAR account. Authentication supports mainnet and testnet, whose named accounts are distinct identities. A matching string on the wrong network must never grant organization membership.

## Current state
`plugins/auth/src/near-invitations.ts:33`:
```ts
.select({ accountId: schema.nearAccount.accountId })
.from(schema.nearAccount)
.where(eq(schema.nearAccount.userId, userId));
```
Acceptance then calls `linked.includes(invitation.nearAccountId)`. The existing `nearAccount` table has both `accountId` and `network`, while invitations have only `nearAccountId`. `contract.ts` defines invite input and invitation output. The UI `InviteMemberValues` contains email, nearAccountId, role and teamId. Follow the existing integration test's `walletInvitation` fixture and direct linked-account fixture; these test identity matching, not SIWN cryptography.

## Design decision
Represent a wallet recipient as account ID plus network, carrying `nearNetwork` through schema, contracts, listing, resend and acceptance. New wallet invitations require a network; UI defaults to mainnet and explicitly shows the selected network, with testnet selectable. Email invitations keep network null. **Do not silently assign a network to legacy wallet invitations:** leave their network null and make them unclaimable with a specific reissue-required error. Admins may cancel/reissue them; do not delete or cancel records automatically. Existing email invitations remain valid. This avoids guessing the intended identity of old invitations.

## Steps and test plan
1. Extend the existing auth tests with two users linked to the same synthetic account name on different networks. Cover listing, claim lookup, acceptance and rejection. Add a legacy null-network invitation fixture. Run the focused command: new wrong-network assertions must fail on the old implementation; existing cases stay green.
2. Add nullable invitation `nearNetwork`, an additive migration and its Drizzle metadata. Register it with Better Auth additional fields. Use a mainnet/testnet enum in input/output validation, require network when creating wallet invitations, reject a supplied network for email invites. Match both fields in all ownership checks, and never emit legacy ambiguous records as claimable. Run the focused command: all auth cases pass, including old-email and legacy-wallet cases. Recreate the test database through existing helpers to verify migrations; never apply to live data.
3. Carry network through UI creation, resend, cards and claim details. Add semantic labels/test IDs and display the network alongside the account. Follow existing form tests. Verify `bun run --cwd ui test src/routes/_layout/_authenticated/_dashboard/orgs/-invite-member-form.test.tsx src/routes/_layout/_authenticated/_dashboard/orgs/-organization-invitations.test.tsx` exits 0.
4. Add cases for correct-network acceptance setting org/team/session, no cross-network discovery, wrong-network 403, invalid/missing new-wallet network, and clear legacy rejection. Run focused tests and all common gates.

## Maintenance
Future supported networks must extend the recipient type and all adapters together. Never derive identity network from an account suffix. Inspect both direct Better Auth creation and the oRPC entry point so one cannot create a newly ambiguous wallet invitation.


## Completion and stop rules
- [ ] Focused tests include the specified regressions and pass.
- [ ] `bun typecheck`, `bun lint`, and `git diff --check` exit 0.
- [ ] No unrelated changes, secrets, dependency changes or live data mutations.
- [ ] Update the index row to DONE only after verification; otherwise record the precise blocker.

Stop if the implementation requires out-of-scope files (apart from imports in explicitly named callers), intended identity/network semantics cannot be established, or a verification gate still fails after two reasonable repair attempts. Report pre-existing test failures separately; never label an incomplete gate as passed.

