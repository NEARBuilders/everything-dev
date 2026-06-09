---
"everything-dev": minor
"every-plugin": minor
---

Rework shared dependency syncing to use resolved config surfaces (`app.api.shared`, `app.auth.shared`, and `plugins.*.shared`) and make host/plugin MF sharing stricter and more explicit. UI module federation sharing is now static, shared-dep conflicts fail loudly, and unresolved exact versions are rejected instead of skipped.
