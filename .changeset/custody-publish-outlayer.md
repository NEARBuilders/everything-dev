---
"everything-dev": minor
---

Custody publish: `bos login --custody` registers an OutLayer Agent Custody wallet during the device-flow approval (stored encrypted per user and network, re-fetchable on re-login), and `publish.auth = "custody"` now implements the long-standing stub — the FastKV `__fastdata_kv` write is submitted through OutLayer's coordinator from the wallet's implicit hex account (the deploy's machine identity), with a gas-balance preflight, typed failure mapping, and an idempotency key derived from the config fingerprint. The approval page gains a custody consent branch. When the `outlayer` CLI is installed, `bos login --custody` also links the wallet into it via `outlayer login --wallet-key`, so one login serves both the bos and outlayer toolchains.
