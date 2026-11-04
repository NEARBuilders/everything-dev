---
"everything-dev": patch
---

Publish confirmation now treats a failed on-chain execution as the designed success state: the registry namespace is codeless, so publishes execute with `CodeDoesNotExist` and the transaction classifier maps near-kit's typed errors (execution failure → included, consumed nonce or missing publish key → terminal with a `bos login --key` repair hint, chain-unknown → grace window) instead of regexing messages. The content read-back also outranks the transaction probe — a "dropped at broadcast" verdict can only be emitted after the registry content check failed to verify in the same iteration, never before a verify.
