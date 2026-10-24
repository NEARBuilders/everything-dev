---
"@everything-dev/auth-plugin": patch
---

Every new session now starts in the user's personal organization: a `session.create` hook fills `activeOrganizationId` with the personal org whenever the session has none, filling only when unset so onboarding redemptions, invitation acceptances, and device-link choices still win. Personal organization naming falls back to "Personal" for nameless users (was "My Organization"). Personal-org identity is consolidated into one module (`personal-organization.ts`) with a shared metadata constant, lookup, and `isPersonalOrganization` check, and `getContext` now computes `isPersonal` with the same metadata-first rule the UI uses.
