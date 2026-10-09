---
"every-plugin": minor
"everything-dev": minor
---

Finish ADR 0023: the generated bootstrap stubs now read two authored override exports from `ui/src/app.ts` — `appLocale` (SSR locale negotiation: locales, defaultLocale, cookieName) and `apiConnectionError` (localized API connection-failure toast copy). Default error/pending/not-found components are set inside the authored `createRouter` factory in `ui/src/router.tsx`. Hard break to v2: children that hand-customized `hydrate.tsx` / `router.server.tsx` get them backed up and deleted by `bos sync`/`bos upgrade`, and must port the customizations into the authored seams (the sync output prints the port guide; originals land in `.bos/sync-backup/<timestamp>/`).
