---
"everything-dev": minor
---

Deepen i18n: locale negotiation from `citynode_locale` cookie + `Accept-Language` (with q-values) during SSR, `Vary: Cookie, Accept-Language` on localized responses, request-scoped locale in router context, a shared locale selection across the main UI and auth bundle runtimes, and localized router-error/API-connection/tenant-validation copy.
