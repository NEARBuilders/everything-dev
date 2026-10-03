---
"ui": minor
---

Add the tenant + node + binding creation wizard.

- Rewrite the admin tenant creation page from a placeholder into a full wizard: inline org creation (if no active org), node details (kind, cascading parent dropdown via `listRootNodes` + `listChildren`, slug, name), tenant + binding form (auto-generated hostname `<slug>.<gateway>` with live `bindingPreflight` validation).
- On submit: `createTenant` → `createNode` → `createBinding` (blocking, with rollback via `deleteNode` + `deleteTenant` on failure), then non-blocking deploy steps for NEAR subaccount (`auth.near.createSubAccount`) and registry config publish (reuses the `publishTenantConfig` pattern with the binding hostname). Failed deploy steps show "partial success" with retry.
- Export `StepList` and `useStepper` from `@/components` barrel (previously built but unused).
- Extend `api/tests/setup.ts` to accept an optional plugins map and a role parameter on `orgContext` (enables `requireOrgRole` middleware in integration tests).
- Add `api/tests/integration/wizard.test.ts` — 5 tests covering the full creation chain, rollback on duplicate hostname, nested country→state→city hierarchy with bindings, and bindingPreflight availability before/after creation.
