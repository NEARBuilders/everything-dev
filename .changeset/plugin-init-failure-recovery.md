---
"every-plugin": patch
---

Plugin initializations that fail are now evicted from the `Effect.cached` cache so the next `usePlugin` call retries instead of returning a permanently-cached failure. When `initialize` fails, the plugin scope is closed immediately, releasing scoped resources (DB pools, caches) that would otherwise leak until process exit. The router is now constructed once per plugin instance rather than on every `createClient` call.
