---
"api": minor
---

Refactor the API shell around a tenants model and remove the legacy in-repo things/votes/registry providers.

- Add `services/tenants.ts` with a `TenantsService` (`listTenantsByOrgIds`, `createTenant`, `updateTenant`, `softDeleteTenant`, `suspendTenant`, `reactivateTenant`, `resolveTenantByAccountId`, `resolveTenantById`, `resolveTenantByOrgId`, `resolveTenantBySubdomain`) backed by a new `tenants` table in `db/schema.ts`
- Extend the `tenants` table with `status` (`active`/`suspended`/`pending_deletion`), `updated_at`, and `deleted_at` columns (soft-delete lifecycle)
- Add routes for `updateTenant`, `deleteTenant` (soft), `suspendTenant`, `reactivateTenant`, `resolveTenantByOrgId`, and `tenantPreflight`; `listTenants` now uses `requireAuth` consistently
- Remove `services/thing.ts`, `services/votes.ts`, and `services/registry.ts` plus their unit tests (`tests/unit/context.test.ts`, `tests/unit/db.test.ts`) and the stale `0000_famous_fabian_cortez` migration
- Update `contract.ts` and `index.ts` to expose tenant routes and drop the removed things/votes/registry routes

The things logic moved to the `@every-plugin/template` plugin as a DB-backed demonstration.