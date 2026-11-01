---
"better-near-auth": patch
---

#340 passkey client hardening: the sandbox executor is pinned to an immutable commit SHA on NEAR-DevHub/near-connect-passkey (was the mutable `refs/heads/main` — every fetch could serve new sandbox code; the manifest bumps to `1.0.2` so cached executors are re-fetched), and every swallowed failure in the client surface now logs with cause — a failing `registerWallet` previously hid the wallet from sign-in silently.
