---
"everything-dev": patch
"host": patch
---

Add fixed-core tenant UI composition for shared hosts so subdomains can resolve BOS configs per request while keeping the host, auth, and API runtime stable. This also adds typed runtime override targets and tenant validation helpers for UI and existing plugin UI/sidebar overrides.
