---
"every-plugin": minor
"everything-dev": minor
"@everything-dev/auth-plugin": patch
---

Add a structured, non-fatal plugin warnings channel. Plugins can declare a `warnings(config)` function on their definition (evaluated once with the validated config; declaring it opts out of the loader's default missing-secret warning), and warnings are surfaced through `InitializedPlugin.warnings`, the host's `PluginStatus.warnings`, `GET /health` and `GET /api/_health`, and consolidated `[Plugins][<key>] ⚠` log lines. The host now emits a default warning when a plugin's declared secrets resolve to nothing (optional secrets were previously silent). The auth plugin omits social providers with missing credentials — better-auth's misleading "Social provider X is missing clientId or clientSecret" boot warning is replaced with per-provider warnings naming the exact variable path and secret key (e.g. `GitHub social sign-in is disabled — GITHUB_CLIENT_SECRET is not set`).
