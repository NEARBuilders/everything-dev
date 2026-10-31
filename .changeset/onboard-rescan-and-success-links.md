---
"everything-dev": patch
---

Auth plugin onboard page: a rescan by someone who has left the community now says they're no longer a member instead of "You're in". The page checks a fresh organization list against the redeemed organization ID, clears a stale active organization, and shows a retryable error if the check fails. The redeem's refusal for a member who left now carries `data.action: "rejoin-organization"`. Child apps can configure the joined screen through the `onboard` auth variable: `links.next`/`links.home` (with an `{organizationId}` placeholder) and `links.explore` for the success and error panels (defaults stay `/build`, `/dashboard`, `/explore`; `next: false` hides the build link), plus `community.url`, an app endpoint that returns the joined community's page and channels for a "Visit {community}" button and channel links.
