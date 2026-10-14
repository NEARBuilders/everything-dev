---
"@everything-dev/auth-plugin": minor
"ui": patch
---

Auth reads route through the typed contract paths instead of the better-auth client surface whose response inference collapses to `any` under tsgo (#374): `listApiKeys` gains the `configId` passthrough (org-keys listing via the contract silently hit user-keys before), and a new `listUserPasskeys` route serves the dashboard passkey check. The admin-client type probes for the collapse land as compile-time canaries in the everything-dev typecheck.
