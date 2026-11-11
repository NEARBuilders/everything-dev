---
"everything-dev": patch
---

Auth plugin surfaces cross-subdomain cookie configuration (#668). New authored variable under `auth.variables`: `crossSubDomainCookies: { enabled, domain }`, mapped to Better Auth's `advanced.crossSubDomainCookies`. When enabled, session cookies carry `Domain=<domain>` so a multi-app family on sibling subdomains (`app.example.com`, `activity.example.com`) shares one session — by config alone, no local auth code. `domain` must be a dot-prefixed registrable domain (`.example.com`) when enabled; without it Better Auth falls back to the base URL's root domain. Absent or disabled config leaves cookies host-scoped (behavior unchanged). Sharing a cookie domain requires every app on it to run the same `BETTER_AUTH_SECRET` — the sealed cookie is decrypted with it — plus sibling `trustedOrigins` entries.
