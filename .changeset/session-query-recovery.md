---
"everything-dev": patch
---

A failing `getSession` request no longer caches `null` as "signed out" — the session query errors instead, so a transient auth-service outage can't sign the UI out client-side.
