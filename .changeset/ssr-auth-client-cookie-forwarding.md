---
"everything-dev": patch
---

SSR: the request-scoped auth client now forwards only the caller's credentials (`cookie`, `authorization`, `x-api-key`, plus `user-agent` and forwarding IP headers) instead of every incoming header, so server-side auth-client calls in route loaders resolve with the caller's session without leaking transport headers (`host`, `content-length`, `accept-encoding`) into the self-fetch. Adds a regression test for cookie forwarding.
