---
"every-plugin": minor
---

One shared Effect-native plugin-load retry policy (`loadRemoteWithRetry`): capped exponential backoff bounded by a wall-clock budget, per-attempt failure logging deduped by classification signature, the poisoned global entry cache purged between attempts, and fail-fast on permanent failures (`classifyPluginFailure().retryable` — MF identity skew, schema validation, dead remotes, TLS verification) instead of silently burning the budget. `withRemoteEntryResilience` and the dev-server's duplicate loop are absorbed by it. MF service logs now read `[MF][<pluginId>] ✅ Registered` / `✅ Loaded constructor` (plugin id no longer duplicated as a log annotation).
