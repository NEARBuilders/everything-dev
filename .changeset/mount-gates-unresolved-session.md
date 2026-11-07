---
"every-plugin": patch
"everything-dev": patch
---

Mount gates no longer send signed-in visitors to `/login` on a client-rendered full page load. When the router context has not resolved the session yet, the `authenticated` and `admin` gates await `resolveSession` (supplied by the client router from the session query) before deciding. The admin gate now keeps the `?redirect=` return path, so a signed-out visit to an admin page comes back to it after sign-in instead of landing on `/dashboard`.
