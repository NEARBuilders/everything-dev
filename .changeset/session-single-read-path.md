---
"everything-dev": patch
"@everything-dev/auth-plugin": patch
---

fix(auth): single authoritative session read path — post-sign-in redirect loop

All session reads (route guards, the login route's beforeLoad, useQuery
observers, the post-sign-in refresh) now share one queryFn that always calls
`getSession({ query: { disableCookieCache: true } })`, so every redirect
decision sees the same authoritative answer and the login ↔ dashboard
ping-pong ("Too many redirects") is structurally impossible. The
post-sign-in refresh (`refreshSessionCache`) overrides staleness so a fresh
signed-out cache entry written by an observer moments earlier cannot
short-circuit it. Removed the redundant authed-redirect triggers on the
login page (component-level `<Navigate>`, loader prefetch), the dead
`rejectAuthed` guard, and the bootstrap WeakSet bookkeeping in
`resolveSessionFromCache`. The server-side better-auth session cookie cache
is disabled outright: it was prod-only (dev and prod behaved differently)
and delayed revocation/ban visibility for up to its maxAge. The login
redirect sanitizer now rejects `/login…` targets, closing the last possible
self-referential redirect loop.
