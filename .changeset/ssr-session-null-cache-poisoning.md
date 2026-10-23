---
"everything-dev": patch
---

Fix the SSR authed-route 307 wall (#527): the root route's session resolver no longer seeds a null host-side session into the query cache — a null context session means "the host did not resolve one", not a verified sign-out. The freshly-seeded null was fresh for the guard's staleTime window, so `requireSession` trusted it and redirected to /login without ever running the session fetch, even with a valid cookie. The explicit signed-out entry (written by `clearAuthenticatedQueries`) still wins.
