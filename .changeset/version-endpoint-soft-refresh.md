---
"everything-dev": minor
"ui": patch
---

Atomic deploys tickets 09-10: the MF integrity fetch hook now treats an SRI mismatch like an origin failure — last-known-good bytes from the bundle cache serve instead (with `x-bundle-cache: stale`) and corrupted origin bytes are never written into the cache; the host process installs the outbound bundle-fetch tier (staged own-namespace reads + stale-if-error). The host serves `GET /.well-known/version` with the deploy fingerprint, which rides the client config; a soft-refresh banner (`version-refresh-banner`) polls it for signed-in sessions and offers a reload when a newer deploy is served.
