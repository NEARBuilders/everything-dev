---
"everything-dev": patch
---

fix(auth): Better Auth api-key calls that omit `configId` no longer fail with "No default api-key configuration found". The auth plugin now fills it in: `apiKey.create({ name })` makes a personal `user-keys` key (`api_…`), a create with `organizationId` makes an `org-keys` key (`org_…`), and `get`/`update`/`delete` look in `user-keys`. Existing keys, prefixes and explicit `configId` calls are unchanged, and `apiKey.list()` still returns the caller's personal keys.
