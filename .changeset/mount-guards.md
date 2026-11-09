---
"every-plugin": patch
"everything-dev": patch
---

Mount guards are ordinary beforeLoads supplied by the composing framework, replacing gate kinds. The mount registry now carries shape metadata only (`guarded`, `implemented`) and `constructTree` takes `guards` keyed by mount id — construction fails loudly when a guarded mount has none. The default wiring guards `authenticated` with `requireSession` and `admin` with `requireAdmin`, so a client-rendered full page load resolves the session through the query cache instead of reading a signed-in visitor as signed out (#818): full loads of authed pages no longer bounce through `/login`, and admin pages keep the `?redirect=` return path. Banned users now bounce at the mount, and signed-in non-admins on admin mounts land on `/dashboard`. The engine's invented `HostContext`/`GateUser` types are gone — it has no auth semantics.
