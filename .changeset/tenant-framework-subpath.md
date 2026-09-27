---
"everything-dev": minor
"ui": minor
---

Tenant draft/url helpers move into the framework: `everything-dev/ui/tenant` is the single owner of the tenant origin construction (`buildTenantUrl`, `tenantLabel`, `isLocalHostname`), the node-config draft helpers (schema, diff, bundle entry resolution, sha384 integrity preflight), and the new `gatewayForAccount` — which derives the gateway for an owner account from the runtime config (the runtime's gateway when the account is on the runtime's network, null otherwise) instead of hardcoding per-network domains. The app-owned `ui/src/lib/tenant-url.ts` and `ui/src/lib/tenant-config-draft.ts` copies are deleted; call sites (tenant live site, node config, node directory, app detail runtime, staking poc) import from the package, so children stop receiving the copies via `bos init` and versions flow through the catalog / changeset release. Closes #184.
