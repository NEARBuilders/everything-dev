# 0028. Config-declared organization permissions

Date: 2026-10-14
Status: Accepted

## Context

The auth plugin's organization access control (Better Auth `createAccessControl` +
roles) lived as hardcoded module constants in `auth-instance.ts`: the statement
catalog (`defaultStatements` + `apiKey` + `email`) and the owner/admin/member grant
maps. The effective permission posture was invisible to operators, not auditable in
the published config, and changing it meant shipping plugin code.

Every auth runtime publishes its resolved config to the FastKV registry (ADR on
config publish), and child runtimes derive from the root runtime's published config
via `extends` (ADR 0022/0023 lineage). Authored configuration — `bos.app.ts` — is
the layer where per-runtime decisions live, while plugin code is shared machinery.
Cloudflare's Workers model informed the shape: a declared catalog of permissions,
roles as explicit grant maps, and everything undeclared denied.

## Decision

1. **The plugin ships no permission defaults.** The statements catalog and role
   grants come entirely from `siwn.permissions` in the plugin's variables:

   ```ts
   siwn: {
     permissions: {
       statements: { email: ["read"], member: ["create", "update", "delete"], ... },
       roles: {
         owner:  { organization: ["update", "delete"], email: ["read"], ... },
         admin:  { ... },
         member: { ... },  // required keys: owner, admin, member
         curator: { ... }, // arbitrary custom roles allowed
       },
     },
   }
   ```

2. **Fail loud at boot.** A resolved config without `permissions`, missing any of
   `owner`/`admin`/`member` (Better Auth assigns `owner` on org creation; the
   plugin's member routes enum all three), a grant on an undeclared statement, or a
   grant of an action outside the statement's declared actions throws a config
   error naming the offending role and grant.

3. **The root runtime declares the canonical posture.** `bos.app.ts` (everything.dev)
   carries the full declaration, transcribed from the pre-config behavior so the
   root's effective posture is unchanged. Child runtimes inherit it through the
   `extends` chain and override per-statement. Standalone auth-plugin deployments
   that do not extend the root must declare the surface themselves.

4. **Effective permissions surface in `getContext`.** The `getContext` output gains
   a nullable `permissions: Record<string, string[]>` map: session principals get
   the grants of their active organization's role; API-key principals get the key's
   declared permissions (an empty map denies everything); anonymous callers get
   `null`. Because the host injects the auth plugin's `getContext` output as every
   plugin's request context, this field is available to all plugins' middleware.

5. **Shared gate middleware.** `createAuthMiddleware` (from `everything-dev/api`)
   gains `requirePermission(resource, action)` — it checks the caller's effective
   permissions map and fails `FORBIDDEN` with
   `data: { requiredPermissions: ["resource:action"] }`.

   **Scope boundary:** the middleware can only see the request context, so it gates
   *active-organization* permissions (and, later, input-resolved team scope).
   Checks against an *explicit* organization id from route input (e.g. `addMember`
   targeting a non-active org, email-visibility masking) stay service-side via
   Better Auth `hasPermission`, which evaluates against the same config-declared
   roles. Platform-admin bypass (`user.role === "admin"`) also stays gate-level,
   via `requireAdmin`/`requireRole` — it is not part of the permission registry.

## Consequences

- The permission posture is visible, editable, and on-chain-auditable per runtime.
- Email visibility is a normal role grant (`email: ["read"]`): removing it from a
  role automatically restricts member-email masking everywhere (the
  `canReadMemberEmails` checks evaluate the same declared roles) — there is no
  separate email-visibility knob.
- Undeclared means denied: a runtime that forgets to grant an operational statement
  (e.g. `member: ["delete"]` to owner/admin) locks that capability out; the skill
  docs carry the copy-paste root posture as the starting point.
- The `ac` statement (dynamic access control) is part of the declared catalog like
  any other; Tier 3 (Better Auth `dynamicAccessControl`) remains deferred.
- Team-scoped grants (Tier 2) extend the same registry with `team_member.role`.
