---
"everything-dev": minor
---

The organization permission surface is now fully config-declared — the plugin ships no defaults. Auth runtimes must declare `siwn.permissions` (a `statements` catalog plus a `roles` grant map; `owner`/`admin`/`member` are required, arbitrary custom roles allowed). Boot fails loud on a missing declaration or a grant referencing an undeclared statement/action. The root `everything.dev` config declares the canonical posture; children inherit it via `extends` and override per-statement. Effective permissions surface in `getContext` output as a nullable `permissions` map (session principals: the active org's role grants; API-key principals: the key's declared permissions), and the shared middleware factory gains `requirePermission(resource, action)` for routes that gate on that map.
