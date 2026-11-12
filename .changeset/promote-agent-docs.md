---
"everything-dev": minor
---

Promote the child-authored agent docs into the template (#597): `docs/agents/` gains `change-placement.md` (bug/missing-capability/pattern-improvement placement, branching-and-stacking rules), `how-it-fits.md` (the drawn runtime tour — authored → published → resolved → served, composition, generated types, `.bos` state surfaces), `testing.md` (testing doctrine and the parent/child coverage boundary), and `coding-standards.md` (write-once, type-safety-is-the-drift-killer, the workaround protocol, the comment `KEEP`/`TODO` policy, deletions-first tests). All four sync to children via the agent-sync globs at the next `bos upgrade`, and the generated child `AGENTS.md` now links them from its Style Requirements, upstream-change-protocol, and Testing sections. The `everything-dev-app` skill reconciles with the corrected child wording (`bos.app.ts`, `pnpm dlx`, the `bos deploy` train) and teaches branch stacking.
