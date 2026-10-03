---
"ui": minor
"api": minor
---

Per-community dashboard bulletin. Community managers can author a short markdown announcement (Events & profile → Bulletin tab) that renders as a bluish bulletin card at the top of the main dashboard and the community overview page, with an UnderConstruction footer linking to the repository. Stored on the node's existing `metadata` jsonb (`bulletin` key) — no migration. Adds a merge-safe `PUT /nodes/{nodeId}/bulletin` route (same team-area + org-ownership gate as `updateNode`) that reads-modifies-writes metadata so other keys like `poolAccountId` are never clobbered. `Markdown` gains a `variant?: "default" | "compact"` prop with compact prose styling for card-sized content.
