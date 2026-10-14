# 053. Auth permissioning — config-declared statements, role grants, and effective permissions

Ticket tracker: `.scratch/auth-permissioning/`
Branches: `feat/auth-permissions-tier1` → `feat/auth-permissions-tier2`, stacked on the
ticket-05 service-layer chain (`refactor/auth-contract-split`, PR #379).
ADR: `docs/adr/0028-config-declared-permissions.md`.

## Design (locked)

- **No plugin defaults.** The permission surface (statements catalog + role grants)
  is fully config-declared in `siwn.permissions`; boot fails loud on a missing
  declaration, missing `owner`/`admin`/`member` roles, or grants referencing
  undeclared statements/actions. The root `bos.app.ts` declares the canonical
  posture (transcribed from the pre-config behavior); children derive via `extends`.
- **Effective permissions in context.** `getContext` returns a nullable
  `permissions` map (session → active-org role grants; API key → key permissions;
  anonymous → null). The host's context bridge carries it to every plugin's
  middleware context via the generated types.
- **Shared gate middleware.** `requirePermission(resource, action)` in
  `everything-dev/api`'s `createAuthMiddleware`. Scope boundary (ADR 0028):
  middleware gates active-org scope; explicit-org checks stay service-side
  (Better Auth `hasPermission` against the same declared roles).
- **Tier 2 — teams.** `team_member.role` migration; team grants ride the same
  registry; `getContext` team entries carry per-team `permissions`;
  `requirePermission` gains an input-resolved team scope; team routes get the
  permission checks Better Auth lacks (the #313 class of bug). Tier 3
  (`dynamicAccessControl`) deferred.

## Tier 1 checklist

- [x] `config-schemas.ts`: required `siwn.permissions` (statements + roles; owner/admin/member enforced)
- [x] `config.ts`: `validatePermissionGrants` fail-loud validation; carried into `AuthConfig`
- [x] `auth-instance.ts`: `buildOrganizationAccess(permissions)` — config-driven `createAccessControl`/`newRole`; hardcoded constants removed
- [x] `PermissionRegistryTag` + `PluginServices.permissionRegistry` + `tagsLayer` wiring
- [x] `SessionService.getContext` effective permissions per principal kind
- [x] `requestContextSchema.permissions` (nullable) — propagates via generated types
- [x] `requirePermission` middleware in `packages/everything-dev/src/api/auth-middleware.ts`
- [x] `nearRelayerInfo` admin gate rewired to `.use(requireAdmin)`
- [x] `bos.app.ts` root posture declaration
- [x] Tests: permission-config fault modes; effective permissions per principal (session+role, session no-org, api key, anonymous)

## Tier 2 checklist

- [x] Audit Better Auth team routes — **no #313-class gap**: all five management routes
      gate on the caller's org role (`crud-team.mjs` :85/:167/:284/:591/:669), evaluated
      against the config-declared roles. Team-scoped *elevation* (direct-write bypass of
      the org-role checks) was **rejected (wontfix)**: no route may bypass Better Auth —
      team-scoped roles are restriction-only, all management writes stay behind Better
      Auth's endpoints and org-role checks.
- [x] Migration `0011`: `team_member.role` (default `"member"`); `db/schema.ts` column
- [x] `PermissionsService.hasTeamPermission` (org ∪ team grants) — **removed post-decision**:
      the union evaluator existed only for the rejected elevation path; team-scope checks
      read the caller's team-role grants from the context (restriction semantics)
- [x] `getContext` team entries gain `permissions` (registry grants for the caller's team role)
- [x] `requirePermission` scope option: `{ scope: "team", teamId: (input) => string | undefined }`
- [x] Role assignment: `addTeamMember` accepts `role` (validated against the declared roles); `listTeamMembers` returns `role`
- [x] Tests: union semantics (org ∪ team), role assignment + undeclared-role rejection, context team map
- [x] Changeset: `@everything-dev/auth-plugin` (minor)

## Docs

- [x] ADR 0028
- [x] GLOSSARY.md: Statement, Role grant, Effective permissions, Permission registry
- [x] `packages/better-near-auth/skills/auth-plugin/SKILL.md`: config surface + root posture
- [x] `packages/everything-dev/skills/api-and-auth/SKILL.md` + `references/middleware.md`: `requirePermission` (+ team scope)
- [x] `plugins/auth/README.md`: config surface

## Verification gates

Per PR: `pnpm --dir plugins/auth exec tsc --noEmit` per step, domain test files during
work, full suite + root `pnpm run typecheck` (regenerates consumed types — proves the
context field propagates end-to-end) + lint at the end. No code review per author
instruction.
