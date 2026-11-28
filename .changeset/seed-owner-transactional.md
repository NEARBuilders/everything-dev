---
"everything-dev": patch
---

`bos seed` provisions the owner admin in one transaction. The `user` → `near_account` → `account` inserts used to land one by one, so a failure after the first left a partial owner that every re-run reported as "already provisioned" — and the owner's first wallet sign-in minted a second, non-admin user. A re-run against a user found by email now backfills the missing wallet and provider rows instead of returning early.

