---
"better-near-auth": patch
---
---
"everything-dev": minor
---
---
"api": minor
---

Auth server sweep (ticket #429b): the account-link policy for deploy keys moved from the oRPC handler into `ApiKeysService.createDeployKey` — the service checks the user's linked NEAR accounts with a direct db read (no second better-auth session round-trip per mint), failing `DeployKeyAccountNotLinked` (mapped to the same FORBIDDEN, same message and `action` data). The three API-key verification flows — the session service's cross-config loop, the api-keys service's permission-fallback two-pass, and the delete fallback — share one `verifyKeyOnce` primitive in `services/api-key-verify.ts`. The device-link hook's vendored-route matcher is named (`DEVICE_TOKEN_ROUTE`) and its body is zod-parsed instead of cast; the CLI exports `DEVICE_LINK_CLIENT_ID` as the single client-id constant. The device approval page's raw `auth.$fetch("/custody/register")` is replaced by a typed `auth.custody.register()` client action. Host: `/api/auth/*` is handled for every method (a method better-auth doesn't serve gets better-auth's own 404, not the SSR fallback), and the `/api/*` timeout middleware exempts `/api/auth/*` by path guard rather than registration order — the scoping is now structural.
