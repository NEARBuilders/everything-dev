---
"everything-dev": patch
---

The auth plugin derives `isProduction` from the served origin's protocol
(`https:` ⇒ production) instead of `NODE_ENV` (#635): the published bundle
bakes `NODE_ENV` at build time, so localhost ran with production cookie
settings — secure cookies plus the 5-minute cookie cache — and sessions
silently dropped on plain http after about five minutes. Production behavior
is unchanged.
