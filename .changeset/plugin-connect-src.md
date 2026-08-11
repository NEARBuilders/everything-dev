---
"everything-dev": minor
"host": minor
---

Add a `connectSrc` field to plugin config so plugins can whitelist external WebSocket/HTTPS origins in the host CSP.

- Plugins can declare `connectSrc: ["wss://relay.damus.io"]` in `bos.config.json`; the host merges these into the CSP `connect-src` directive in both dev and prod
- `connectSrc` arrays are unioned across `extends` chains (like `secrets`)
- The field flows through `RuntimePluginConfig`, DAG nodes, and tenant plugin overrides
- Removes the need for dev-only proxy workarounds (e.g. `relay-proxy.mjs`) to reach third-party relays in production
