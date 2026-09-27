---
"everything-dev": patch
"ui": major
"api": minor
---

Tenant creation on the admin dashboard now requires connecting a sputnik-dao account via the Trezu wallet (separate from the existing SIWN session wallet). The connected DAO account owns the new tenant: `tenants.accountId` is the DAO, `bos.config.json` is published at `bos://<dao>/<gateway>` and inherits the platform base. The API gains `requireAdmin` + a server-side `get_policy` view call that confirms the session user's primary NEAR account appears in an explicit DAO policy group before accepting the create. `tenants.owner_kind` (default `platform`) is added to flag DAO-owned rows and to gate the DAO-aware republish flow.

The platform subaccount flow (`siwn.subAccount.*`, `NEAR_SUB_ACCOUNT_PARENT_KEY_*`) is removed. Existing tenants created before this update keep working — the host is account-agnostic — but the admin wizard is now DAO-only.
