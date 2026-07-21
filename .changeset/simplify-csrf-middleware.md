---
"host": patch
---

Simplify CSRF middleware: remove origin/referer whitelist and rely on Host header matching. Same-origin requests pass automatically (covering all tenant domains), no-Origin requests pass through (non-browser clients), and cross-origin POSTs from unserved origins are blocked.
