---
"everything-dev": minor
---

auth: remove organization approval — it's application business logic, not auth (#857)

Organizations are now created **active**; the auth plugin never sets or enforces a
pending/rejected status, and no middleware gates on organization status.
Self-service activation flows (create organization → create onboarding code →
redeem, invite, join) now succeed end-to-end for a fresh user with no
platform-admin step.

**Breaking — removed surfaces:**
- `listOrganizationRequests` / `reviewOrganization` auth routes (the platform-admin
  review queue) and the organization-approval gates in every default middleware,
  the session context, and the invitation/onboarding flows.
- `requestedBy` / `rejectionReason` fields on the organization contract output.
  The `status` field stays (pass-through data). The DB columns (`requested_by`,
  `rejection_reason`) remain in place, unused, so no migration is required.

**Migration for deployed consumers:** existing `pending`/`rejected` organizations
become fully operable the moment this ships (the session context stops filtering
them and no middleware asserts status). If approval was a product requirement for
your app, implement it app-side before exposing org-scoped writes — org status in
metadata, your own middleware, your own admin surface. To retire stale rows, flip
`status` to `active` in an app-managed migration (the columns are app-owned data
now).
