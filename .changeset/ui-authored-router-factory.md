---
"everything-dev": minor
"ui": minor
---

Invert router control: the app's authored router factory is now load-bearing. The client hydrator accepts `createRouter` and `createQueryClient` (framework factories remain the fallback), and the SSR router module mints each request's router through the same factory — so notFound/pending/error components, scroll behavior, and query timings are app-customizable for the first time, with server/client parity.
