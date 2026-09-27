---
"@everything-dev/auth-plugin": patch
"everything-dev": patch
---

Start-command regression stack fixes (the deployment-image path):

- The regression container's fixture config now injects the auth plugin's `baseUrl` variable (`http://localhost:<port>`, the bos start ingress). The domain-derived `https://` baseURL made better-auth set Secure cookies that no http client (Go jar or browser) can send back: sign-in succeeded but every session-bearing request 401'd. The config variable wins over the host's domain derivation by construction — production stacks are untouched.
- The auth plugin's better-auth core rate limiter can be disabled via `BETTER_AUTH_RATE_LIMIT_DISABLED=1` — production defaults it on with a single shared per-path bucket when no client IP is resolvable, which the regression suite's `/api/auth/*` traffic trips within seconds.
- The regression container now forwards the harness's `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, and `BODY_LIMIT_MAX` into the image — without them the host's middlewares ran defaults, so the oversized-body pin got a 404 (no procedure match for a 70KB text body) instead of 413, and the rate-limit burst never saw a 429.
