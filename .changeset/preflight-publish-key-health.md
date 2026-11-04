---
"everything-dev": patch
---

The deploy preflight verifies the signing key's on-chain health before the build train runs: the key must exist on the publisher account and be scoped to `__fastdata_kv` on the registry namespace with enough remaining allowance for one publish (300 Tgas prepaid). A rotated or exhausted key now fails in seconds with the exact on-chain repair command (`near account add-key …`) instead of surfacing after a full build as a broadcast that never appears on-chain. The confirmation classifier also recognizes the chain's real not-found shape (`UNKNOWN_TRANSACTION`), so a dropped broadcast again reaches the terminal verdict and its one identical resubmit instead of timing out generically.
