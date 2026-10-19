---
"@everything-dev/auth-plugin": patch
---

Session resolved once per authed call (#429): the host session middleware now makes a single `getContext` call (which carries the session row and user) instead of parallel `getSession` + `getContext` round-trips, `requireAuth` memoizes `sessionId`/`activeOrganizationId` into the oRPC context instead of discarding them, and the auth services (`requireOrganizer`, `listUserTeams`, `redeemOnboardingCode`, `addMember`, `getInvitation`) take session-derived values as explicit parameters instead of re-hitting better-auth with raw headers. `getContext` output carries the resolved `session` (id, token, userId, expiresAt, activeOrganizationId, activeTeamId, user) so the host and handlers can reuse the one resolution.
