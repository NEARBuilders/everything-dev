---
"ui": patch
"everything-dev": patch
---

Update the UI auth client to a single options object that carries `runtimeConfig`, `headers`, and `cspNonce`, remove the deprecated `auth-utils` helper module during upgrades, and drop the direct `@hot-labs/near-connect` dependency from the UI package.
