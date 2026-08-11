---
"api": minor
"ui": patch
---

Scope tenant routes to the active organization via the `requireOrganization` auth middleware.

- `listTenants` and `createTenant` now require an active organization (401/403 when unauthenticated or no active org selected)
- `createTenant` derives the tenant's `orgId` from `context.organization.activeOrganizationId` instead of trusting a client-supplied `orgId`, which was removed from the contract input
- Reorder the tenant creation UI flow so the new organization is set active before the tenant is registered, and roll back the org if activating it fails
