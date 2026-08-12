---
"host": patch
---

Add `wss:` scheme to CSP `connect-src` directive to allow WebSocket connections (e.g. nostr relays, streaming APIs). Plugins declaring `connectSrc` with `wss://` URLs now work through the host without per-request CSP overrides.
