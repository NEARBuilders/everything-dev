---
"everything-dev": patch
---

The dev chain audit closes the loop: a successful `bos dev` boot fetches each composed remote slot's version-manifest and compares its embedded **strict singletons** (critical names per the shared-dep specs — `every-plugin`, `effect`, `@orpc/*`, the UI flips) against the versions this runtime actually composes; divergences print one line per slot with the ownership-correct repair — inherited → `run bos upgrade`, owned → `run bos plugin publish <key>`, and slots provisioned upstream after the pinned release print "run bos upgrade to inherit". The audit never blocks boot and reads no npm. It is the user-visible face of the compat machinery: same strict-singleton law as the training gate (critical ⇒ exact), slot payloads, and boot guard, so one mismatch reads the same in the train and on screen.
