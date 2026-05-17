---
"everything-dev": patch
"host": patch
---

Add fixed-core tenant UI composition for shared hosts so subdomains can resolve BOS configs per request while keeping the host, auth, and API runtime stable. This also hardens tenant remote integrity verification with bounded streaming, background refresh for asset requests, and safer SSR cache invalidation for updated remotes.
