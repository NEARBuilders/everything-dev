---
"everything-dev": patch
---

Publish confirmation now queries the submitted transaction's status: rejected or dropped transactions fail fast with their on-chain fate instead of a generic "registry serves a different value" timeout, and a transaction that will never apply is retried once with identical content (fresh nonce) before the deploy fails.
