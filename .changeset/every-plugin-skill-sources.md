---
"every-plugin": patch
---

Fix stale `metadata.sources` in the `plugin-client` and `plugin-testing` skills (`api/src/lib/auth.ts` → the auth-middleware module, `src/testing/index.ts` → the runtime entry).
