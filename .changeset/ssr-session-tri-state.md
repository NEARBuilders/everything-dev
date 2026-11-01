---
"everything-dev": patch
---

SSR session resolution is tri-state and never round-trips the public edge on the hot path (#689). The host's per-request in-process `getContext` resolution now distinguishes **unresolved** (no auth plugin, or resolution failed → `undefined`) from **authoritative sign-out** (getContext succeeded with no session → `null`). The SSR query-cache seeding follows: authoritative null seeds the cache (the same explicit signed-out entry sign-out writes), undefined leaves it empty so the guard's fetch still runs — closing the #527 failure mode where a wedged auth resolution redirected signed-in users to /login without ever fetching. A server-side session-fetch failure degrades to a signed-out render instead of failing the whole document: an edge rate-limit or block page can no longer 500 every SSR page for every visitor.
