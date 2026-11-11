---
"everything-dev": patch
---

Revert the regression harness's file-backed pglite substitution: the dev stack
opens the auth database from two processes (the auth service and the auth-plugin
instance composed into the api/host), and a per-secret shared data dir turned
that topology into ADR 0044's silent-corruption case — the suite died on
system-catalog reads past EOF (`pg_attribute`, "unexpected data beyond EOF").
The harness is restored to in-memory pglite, whose per-process databases made
the dual-open harmless. App fixtures for regression specs still seed over HTTP;
a file-backed mode needs a single-writer story first (seed through the running
stack, not pre-spawn against shared files).
