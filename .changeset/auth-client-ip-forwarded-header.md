---
"@everything-dev/auth-plugin": patch
---

Better Auth resolves the client IP from `x-forwarded-for`

Behind a reverse proxy (Railway, and most PaaS ingress) the socket address is the proxy's, so Better Auth could not resolve the client IP and rate limiting collapsed into one shared per-path bucket — a single abusive client could throttle everyone. The `advanced.ipAddress.ipAddressHeaders` config now trusts the standard forwarded header; deployments without a proxy are unaffected (the header is absent and the existing fallback applies). Trust precondition: the proxy must **overwrite** `x-forwarded-for`, not append — a host reachable directly by clients lets them forge the header and rotate IPs past per-IP rate limits.
