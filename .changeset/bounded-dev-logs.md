---
"everything-dev": patch
---

bos dev prunes dated logs — bounded `.bos/logs` sediment

Every `bos dev` boot wrote a dated `dev-<ts>-<pid>.log` (plus a per-pid `dev-latest-<pid>.log`) and nothing ever cleaned them up — 79 files after nine working days on a child. Each boot now prunes the dated logs: keep the newest 20, drop anything older than 7 days, and never touch files modified in the last 24 hours (a concurrent live session may still be appending). `dev-latest.log` and the regression stacks' non-dated logs are never pruned.
