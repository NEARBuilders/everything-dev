---
"everything-dev": minor
---

Deploy output polish (ticket #431) — a sectioned train renderer with attributed warnings:

- **Sections**: Build / Upload / Publish render through a new `DeployTrainRenderService` (implemented by `cli/render/deploy-train.ts`), in deterministic target order — parallel upload units can no longer interleave their output. Image+Railway leg rows keep `renderDeployLegs`.
- **Attributed warnings**: `WorkspaceDeployResult` gains the structured `warnings` field the CLI was already rendering — build stderr is buffered per workspace, warning segments (rsbuild boxes, WARNING lines) are extracted and attributed to the workspace; raw stderr streams only under `--verbose`. `$ ` command echoes never count as warnings.
- **One line per workspace upload by default**: the ✓ line carries the aligned 28-char name column, the bundle base, upload/skip counts, and duration; detail lines (manifest-diff skips, the version-manifest pin row, source archive) print only under `--verbose`, indented under the workspace's named ✓ line — the version-manifest row is no longer a context-free empty-pad row that parallel uploads scatter across other workspaces' output. The upload leg itself is silent — it returns structured detail and the renderer decides.
- **Output snapshot tests** pin the section layout: column alignment, default-vs-verbose, the publish section (registry URL, fingerprint, slot pins, audit manifest), and the attributed warnings block. Image+Railway keep their existing leg rows (`renderDeployLegs`) — the one section that was already sectioned.
