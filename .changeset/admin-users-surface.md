---
"@everything-dev/auth-plugin": minor
---

Add a typed platform-admin user-management surface to the auth plugin: oRPC contract routes for listing/searching users, get-user, role changes, ban/unban (reason + expiry), session listing and revocation, password resets and user removal — all gated on the platform admin role and backed by the Better Auth admin server endpoints. Adds a `listUserPasskeys` contract route. The auth plugin UI gains an admin-gated Users page (search, pagination, row actions, sessions dialog, impersonation via the Better Auth client).
