---
"everything-dev": patch
---

Scaffolded docs reference `bos.app.ts`, not `bos.config.json`. The init-scaffolded README/AGENTS/skill templates told users the runtime configuration lives in a root `bos.config.json` — but the scaffold generates (and tests assert) the authored `bos.app.ts` descriptor. Cosmetic doc sweep; legacy JSON configs in existing child repos still load.
