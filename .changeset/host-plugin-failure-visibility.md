---
"host": minor
---

Plugin boot failures are structured end-to-end: `PluginBootstrapError` carries the failing runtime operation and classification, bootstrap errors log as `[Plugins][<key>] Failed to load plugin (<operation>) — permanent|retryable`, and `/health` + `/api/_health` expose a structured `failures` array (pluginKey, operation, kind, retryable, suggestion, masked DB URL) instead of only joined strings.
