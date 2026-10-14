---
"host": patch
---

`/api/mcp` now requires authentication (session or `x-api-key`), matching every other API surface (#309). Anonymous callers previously received the full tool catalog via `tools/list` — including admin-only operations — before being rejected at call time; unauthenticated requests now get a 401 with a `WWW-Authenticate` hint. Authenticated clients are unchanged.
