---
"everything-dev": minor
---

Sync preserves child-authored content in framework-owned files and children gain a blessed CI surface (#538):

- **Child-owned block protocol** — a framework-owned file may embed the span between `// child-owned-start` / `// child-owned-end` comments (shown around `variables` in `api/plugin.dev.ts`); sync lifts the span out of the local copy, splices it into the freshly built template content, and never reports it as a conflict. Marker-less local copies migrate once: the `variables: { … },` literal is lifted onto the protocol at the next sync.
- **Blessed child CI workflow** — `.github/workflows/ci-child.yml` ships as a child-owned placeholder (never in the framework-owned inventory); the template `ci.yml` shrinks to triggers + the pinned `consumer-ci` reusable call + the local `child-ci` call, with lint/typecheck/test and the platform-drift alarm moving into the reusable call itself. The merge gate asserts both calls (`needs: [ci, child-ci]`).
