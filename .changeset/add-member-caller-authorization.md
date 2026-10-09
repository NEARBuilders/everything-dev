---
"@everything-dev/auth-plugin": patch
---

Adding a member directly now requires the caller's Better Auth `member:create` permission in the target organization (owners and admins), and only owners can add owners. Platform admins keep access.
