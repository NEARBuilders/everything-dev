---
"everything-dev": patch
---

`bos deploy`'s upload concurrency cap (`BOS_UPLOAD_CONCURRENCY`) holds for the whole train again. A woken waiter was never counted against the cap, so every queued upload permanently leaked a slot — on a many-workspace deploy the cap drifted until uploads ran unbounded against the storage origin.

