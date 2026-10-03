---
"everything-dev": minor
---

`bos init` gains starter levels: `--level simple|advanced` (default `simple`).
Simple scaffolds the public shell only; both levels exclude parent-only
product routes. The chosen level persists in `bos.app.ts` and the sync
snapshot.
