---
"everything-dev": patch
---

`everything-dev/ui/auth` now exports the workspace synchronization helper (`createWorkspaceSynchronization`, `reportWorkspaceRefreshError`, `WorkspaceRefreshError`, `teamWorkspaceQueryKey`). Plugin UIs that change the active organization or team (invite acceptance, team edits, org switching) can refresh the session, the team-workspace query, and route guards the same way the core shell does, instead of hard-coding the shell's query keys. The core ui re-exports them from its previous `@/lib/workspace-synchronization` path.
