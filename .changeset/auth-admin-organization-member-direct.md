---
"everything-dev": patch
---

auth: admin member management no longer depends on the admin's own organization membership (#876 follow-up)

`adminAddMember` forwarded the caller's headers into Better Auth's `addMember`, which checks the
caller's **organization** permissions — so a platform admin who was not a member of the target
organization (the whole point of an admin route) got FORBIDDEN. The mutation is now a direct write,
like every other mutation in `AdminOrganizationsService`: it enforces the organization membership
limit through the plugin's membership policy and refuses duplicate memberships. The integration
suite now covers adding a member to an organization the admin does not belong to — the case the
previous tests masked by creating every fixture organization owned by the admin.

Two smaller consistency fixes ride along:

- `adminUpdateMemberRole` refuses to demote an organization's **only owner** to a non-owner role,
  matching `adminRemoveMember`'s existing last-owner guard.
- `getOrganizationForAdmin` guards with the standard `requireAdmin` middleware instead of a
  hand-rolled role check, matching the admin routes' pattern.

`crossSubDomainCookies` (#668) also gained config-time warnings for the two ways a shared cookie
domain fails silently at the browser: a `domain` that does not cover the app's own `baseUrl` host
(browsers drop the cookie outright, breaking sign-in) and localhost/loopback base URLs (browsers
refuse `Domain` attributes there). The auth plugin README now documents the full multi-app recipe —
shared cookie domain + shared `BETTER_AUTH_SECRET` + shared `postgres://` `AUTH_DATABASE_URL` —
mirroring the ADR 0027 decomposition.
