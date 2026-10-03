---
"everything-dev": patch
"@everything-dev/auth-plugin": patch
---

Local stacks now export the host origin as `BASE_URL` (dev orchestrator env + regression stack env), so the auth plugin's Better Auth instance stops falling back to the hardcoded `http://localhost:3000`. Previously every baseURL-derived URL — invite-email accept links, passkey RP-id derivation, callback URLs — pointed at port 3000 while the stack actually ran on the configured host port, breaking any non-3000 deployment of a local stack.

Regression test databases also get a DB-level `lock_timeout` (10s): postgres lock waits are unbounded by default, so one lingering transaction could stall every later request touching the same rows for minutes with no error.
