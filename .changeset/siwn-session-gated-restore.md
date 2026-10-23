---
"better-near-auth": patch
---

Gate the session restore behind a live session: the siwn client no longer calls the session-gated /near/list-accounts endpoint at init for anonymous visitors (every first load logged a 401); the restore runs at init only when a session exists and re-runs on the sign-in transition.
