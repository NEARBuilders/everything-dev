---
"@everything-dev/auth-plugin": minor
"api": patch
"ui": patch
"everything-dev": patch
---

Require platform-admin approval for self-service organizations, expose pending and rejected request status, and prevent unapproved organizations from being activated or linked to tenants. Personal signup organizations remain active.

Block direct member additions before approval and preserve shared organizations when the original requester's account is removed.

Enforce organization approval through shared authorization middleware and infer organization status in the UI from the auth API contract.
