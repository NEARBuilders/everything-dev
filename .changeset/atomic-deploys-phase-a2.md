---
"every-plugin": minor
"everything-dev": minor
---

Atomic deploys phase A completed (tickets 03-04 of .scratch/atomic-deploys): the deploy leg now composes an immutable per-workspace version manifest from the server-computed SRI map, uploads it additively at `versions/<id>.json`, and pins slots by manifest pointer (`manifest` + the manifest's SRI) — a dist that cannot pin (no build report / no entry SRI) aborts the train instead of writing fallback pointer entries (hard break). Upload transport hardened: status-0 retries on fresh connections (`connection: close`, 5 attempts, backoff+jitter), retryable statuses capped at 3. Resolution derives entry-level fields (`entryUrl`, hashed browser-manifest `entry`, entry SRI, `ssrEntryUrl`) from the version manifest behind a content-addressed per-pin cache; consumers (host html/head/ui-compose/plugins SSR loads/federation SSR entries/mf type inference, hydrate manifest registration) prefer the derived hashed URLs with fixed-name fallbacks only for dev and local slots.
