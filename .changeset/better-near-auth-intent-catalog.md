---
"better-near-auth": patch
---

Unify the `@tanstack/intent` devDependency on the workspace catalog (was a stale `^0.0.40` pin) and refresh the `auth-plugin` skill's version anchors to 1.10.x (library_version, compatibility table). Re-export `readSessionNearAccountId` from `better-near-auth/client` — the SIWN client skill teaches importing it there (the session-linked account narrowing helper was previously internal to `store.js`).
