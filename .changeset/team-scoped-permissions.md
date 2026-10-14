---
"@everything-dev/auth-plugin": minor
---

Team members now carry a role: `team_member.role` (defaults to `member`, migration applied on boot). Team-scoped grants ride the same `siwn.permissions.roles` registry — a member's effective team permissions are the union of their organization-role grants and their team-role grants, and `getContext`'s `organization.teams` entries now carry a per-team `permissions` map. `POST /v1/auth/teams/members` accepts an optional `role` (validated against the declared roles), and `listTeamMembers` returns each member's `role`. The shared `requirePermission` middleware gains a team scope: `requirePermission("team", "update", { scope: "team", teamId: (input) => input.teamId })` checks the caller's grants for the team resolved from the route input. Better Auth's own organization-role checks on team routes are unchanged; full team-scoped elevation (bypassing them for team-limited managers) is deferred — see `docs/plans/053`.
