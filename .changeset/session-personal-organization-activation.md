---
"@everything-dev/auth-plugin": patch
---

Every new session now starts in the user's personal organization, and returning users are restored to their previously active organization and team. A `session.create` hook fills `activeOrganizationId` with the user's remembered preference (persisted on the user row via a `session.update` mirror hook, onboarding redemption, and near-invitation acceptance) when the choice still holds — the user is still a member and the org is still active — and falls back to the personal org otherwise; `activeTeamId` is restored only when the remembered team belongs to the remembered org. Personal organization naming falls back to "Personal" for nameless users (was "My Organization"). Personal-org identity is consolidated into one module (`personal-organization.ts`) with a shared metadata constant, lookup, and `isPersonalOrganization` check, and `getContext` now computes `isPersonal` with the same metadata-first rule the UI uses.
