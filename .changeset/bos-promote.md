---
"everything-dev": minor
---

`bos promote <block-height>` — activate a recorded deployment without rebuilding (ADR 0042 ticket 05, absorbing the unified-rollback plan): the same SRI-verified, boot-checked, pointer-restoring republish as `bos rollback --version`, framed as promotion — no rolledBackFrom brand on the payload, an already-live target is an idempotent no-op rather than a refusal, and the version is required (promotion targets a record, not "previous"). The lockfile consumption rides the train's ticket-04 leg: the promoted composition is frozen into bos.lock.json atomically after confirm, and the deployment record named its digest all along. The Railway image leg stays in CI's deploy workflow (the CLI holds no Railway credential); the config/pointer/lockfile plane is complete from here.
