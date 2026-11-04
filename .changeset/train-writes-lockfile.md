---
"everything-dev": minor
---

The deploy train freezes the composition it publishes (ADR 0042 ticket 04): every publish composes `bos.lock.json` from the exact publish payload and writes it atomically (healed on already-published idempotent runs), and the per-deploy audit record (`deploys/<ts>.json`) names the lockfile's content digest and fingerprint — a deployment record now answers "what exact composition was live". `everything-dev/lockfile` gains `digestOfLockfile` and the sync `writeLockfileSync` (the train's publish path is sync-fs). The registry's fingerprint module consolidates both identity hashes: `pointerFingerprint` remains THE composition identity (lockfile, deploy records, watch change-detection); `deploymentFingerprint` (the serving-generation payload hash, moved here from the host) is documented as derived from the same remotes after entry resolution — their semantic merge stays a recorded seam, since both sides of every existing comparison must move together.
