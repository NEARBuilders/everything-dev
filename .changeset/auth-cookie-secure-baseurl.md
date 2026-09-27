---
"everything-dev": patch
---

fix(auth): derive cookie Secure from the baseURL protocol, not NODE_ENV

The regression container serves http://localhost:<port> in production mode.
`advanced.defaultCookieAttributes.secure: isProduction` forced the `Secure`
attribute onto every better-auth cookie (spreading after the baseURL-derived
value), so cookies set over plain http were never sent back — sign-in
succeeded but every session-bearing request 401'd. The Secure attribute and
the `__Secure-` name prefix now derive together from the baseURL protocol via
`advanced.useSecureCookies`: https deployments (production, staging) are
unchanged, http origins issue sendable cookies.
