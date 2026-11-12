---
"everything-dev": patch
---

Fix the deploy train's platform-manifest truth gate falsely rejecting deploys when a shared-singleton catalog pin is range-shaped: `every-plugin: ^3.0.0-rc.11` in the workspace catalog was compared string-for-string against the exact version recorded in each uploaded bundle's version manifest (`3.0.0-rc.11`), flagging every plugin workspace with "a stale install publishes a manifest that lies about the uploaded bytes" even though the install was current. The gate now compares semantically via the same `satisfiesConstraint` helper the boot-side compat gate uses — exact pins must match exactly, range pins must be satisfied by the built version (#563 follow-up).
