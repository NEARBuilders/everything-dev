---
"@everything-dev/auth-plugin": minor
"ui": minor
"everything-dev": patch
---

Add organization onboarding stations: an owner/admin creates a capped, expiring onboarding code (named after an event) from the org page's new Onboard tab, and displays it as a QR. People scan it with a phone, land on `/onboard`, and join the organization — plus the event's team (find-or-create by event name) — by signing in with a passkey wallet or an existing NEAR wallet. Includes live redemption status (joined list polled every 2s), code revocation, idempotent redemption, and membership-capacity enforcement. Also fixes the stale `development` export condition for `everything-dev/ui/manifest-generator` left by the manifest refactor.
