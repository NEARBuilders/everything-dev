---
"@everything-dev/auth-plugin": minor
---

Generic onboarding stats in the published auth plugin (absorbs the last citynode-specific contract surface, letting children delete their local plugins/auth copies):

- New route `GET /v1/auth/onboarding/stats` (`getOnboardingStats`), input `{ month?: "YYYY-MM", organizationId?: string }`, output `{ month, totals: { redeemed, newMembers }, organizations: [{ organizationId, organizationName, redeemed, newMembers }] }` over a single-DB SQL aggregation of onboarding redemptions. Month defaults to the current UTC month and windows are UTC first-of-month boundaries. With `organizationId` the caller must be an organizer of that organization and stats scope to it; without it the caller must be a platform admin and stats cover all organizations. `newMembers` counts distinct users whose membership in the organization was created within the same month window — users who joined by invitation or redeemed in an earlier month count as redeemed but not new.
- `listOnboardingCodes` gains an optional `eventId` filter alongside `organizationId`.
