---
"@everything-dev/auth-plugin": minor
"api": minor
"ui": minor
---

Event-linked Onboarding Codes, Organizers and a station view:

- Onboarding Codes are tied to a Node Event. `createOnboardingCode` now requires `eventId` and `eventName` (a display snapshot) and takes an optional `expiresAt` in place of `expiresInHours`; codes for the same event share one Event Team, two events with the same title get separate teams, and renaming a team doesn't affect lookup. The raw code is stored encrypted at rest (HKDF-SHA256 → AES-256-GCM from `BETTER_AUTH_SECRET`) beside its hash. Migration `0007_onboarding_code_event` adds `event_id` and `encrypted_code`.
- New API route `createEventOnboardingCode({ eventId, maxUses?, expiresAt? })` loads the Node Event, refuses non-event activities, nodes whose tenant has no organization, and organizations other than the caller's active one, then creates the code through the auth plugin in-process with a default expiry of event end + 48h.
- Organizers — organization owners, admins, or members of a Team granted the new `events` Feature Area — can create, list and revoke codes and open a station. New auth procedure `getOnboardingStation` returns the decrypted code for an active code to an Organizer of its organization.
- Redeeming a code sets the active organization only and no longer switches the Active Team. At the organization membership limit, redemption fails with "This organization is full". The limit is configurable through the auth plugin's `organizationMembershipLimit` variable (citynode sets 1000). `getOnboardingCodeInfo` reports `usedUp`.
- UI: event rows in the activity editor get "Start onboarding", which opens a fullscreen station at `/onboarding/station/$codeId` (large QR on the Gateway Origin, live joined count, recent joiners), reopenable from the org Onboard tab for any active code. The free-text event name form is removed, and the onboarding page explains used-up codes.
- UI: the activity editor lists events on a date timeline with Upcoming (default) and Past tabs and per-tab counts. Days get a sticky header in the viewer's timezone (year shown outside the current year), and cards show the start time with the event-local time when the event is in another offset, the organizer, venue, status badges and the existing actions. Posts keep the flat list.
