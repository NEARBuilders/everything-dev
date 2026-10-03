---
"everything-dev": major
---

`bos plugin publish <key>` joins the atomic-deploy train — full parity with
`bos deploy` scoped to one plugin: preflight (storage/CDN credentials +
signing) fails fast before any build, then build → upload to the R2-backed
storage → compose + pin the workspace's version manifest → config write-back
→ FastKV publish + read-back confirmation. Breaking: the image-native
`applyPluginPublishUrl` path is deleted — a plugin publish ships real bytes
to the storage origin; it requires the storage credentials (BOS_STORAGE_API_KEY
or a bos login session) it previously skipped. Tenant UI overrides are
pin-aware: the org node-config editor accepts and verifies a
`pin: { manifest, integrity }` (the "fetch bundle" flow copies the pin from
the deployed config), and the host verifies tenant override entries at their
pin-derived hashed URLs instead of the fixed entry name. The dormant
local-production config helper (`prepareLocalProductionConfig`, ADR 0009) is
deleted.
