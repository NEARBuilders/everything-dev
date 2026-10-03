---
"api": minor
"@everything-dev/auth-plugin": patch
---

User-owned tenant spawning plus dev passkeys on localhost.

**api**
- New `spawnTenant` route (`POST /tenants/spawn`): session-gated — creates a tenant owned by the signed-in user's linked NEAR account (wallet or passkey-derived `0s…`) with the given hostname as its verified-or-pending primary binding, in one transaction. Returns the tenant, binding, owner account, and a `publishStatus` of `pending_funding` (passkey-derived owner) or `ready`.
- New `getSpawnStatus` route (`GET /tenants/spawn/{tenantId}`) for owner-scoped spawn polling.
- `tenants.owner_user_id` column (migration included); `ownerKind` gains `"user"`; `authorizedTenant` authorizes user-owned tenants for their owner; `listTenants` returns a user's owned tenants without requiring an active organization.
- Bindings whose hostname falls under a configured gateway zone are verified automatically (the platform owns that DNS; TXT verification stays for tenant-brought custom domains). Configure via the new `gatewayDomains` api variable (comma-separated).
- The `requireOrganization` gate on `listTenants` is gone for organization-less users, who now get their personal tenant list instead of `FORBIDDEN`.

**@everything-dev/auth-plugin**
- Passkey RP ID resolves to the local hostname when the auth origin is `localhost`/`127.0.0.1` (dev), so passkey creation and assertion work in local development; production keeps the configured `passkey.rpID`. Override with `PASSKEY_RPID`.
