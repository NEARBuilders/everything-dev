---
"@everything-dev/auth-plugin": patch
"everything-dev": patch
"ui": patch
---

Post-sign-in redirect loop fix ("Too many redirects" after a successful login). The login page navigated to the redirect target before the refreshed session landed in the query cache, and the authed route guards read that cache via `ensureQueryData`, which returns a stale value immediately — so the guard bounced the just-signed-in user back to `/login`, the login route bounced them forward again, and the two guards ping-ponged past TanStack Router's 20-redirect limit into a root-boundary "Application error". Three fixes:

- The login page (and the device-pairing claim path) now refresh the session cache **authoritatively** — `getSession({ query: { disableCookieCache: true } })`, since the Better Auth session cookie cache can still serve the pre-sign-in signed-out snapshot for up to 5 minutes — and seed the `["session"]` query before navigating.
- Route guards (`requireSession`/`requireAdmin`, `_authenticated`, `_admin`) read the session via `queryClient.query()`, which **awaits** the refetch when the cached value is stale instead of trusting it.
- Banned users no longer ping-pong: the login route skips its authed-visitor redirect for banned sessions, breaking the `/login#banned` ↔ `/dashboard` cycle.

Covered by router-level regression tests (plugins/auth/ui `login.test.tsx`, ui `auth-guards.test.ts`) and a browser regression in `tests/regression/browser/specs/auth-redirect.spec.ts`.
