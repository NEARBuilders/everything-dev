---
"everything-dev": patch
---

fix(everything-dev): keep localhost origins in local production starts

The production-start localhost-origin purge now fires only for registry-fetched
starts (`BOS_ACCOUNT`/`BOS_GATEWAY` — real deployments, where a localhost
`CORS_ORIGIN`/`BASE_URL` is a stray dev leftover). Explicit `--config-path`
starts (the regression harness) and bare local `bos start` runs keep their
injected origins: the in-process host's auth seam reads them from
`process.env`, and an https fallback there made better-auth issue Secure
cookies no http client could send back — sign-in succeeded but every
session-bearing request 401'd, and untrusted origins rejected writes with
`INVALID_ORIGIN`.
