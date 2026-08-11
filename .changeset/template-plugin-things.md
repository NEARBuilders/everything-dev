---
"@every-plugin/template": patch
"ui": patch
---

Route the things UI through the namespaced `template` plugin client and enforce auth on thing writes.

- Things routes in the UI now call `apiClient.template.createThing`, `apiClient.template.getThing`, `apiClient.template.deleteThing`, and `apiClient.template.listThings` instead of the removed top-level `api` client methods; `live.tsx` no longer needs a cast to reach the template client
- The parent API now proxies thing routes to the template plugin through the in-process `templateClient`, keeping `createThing`/`deleteThing` auth-protected at the API boundary with `requireAuth` while `getThing`/`listThings` remain public
- The template plugin's `createThing` and `deleteThing` handlers no longer enforce auth themselves (auth is enforced by the parent API), so direct plugin-to-plugin calls don't depend on per-call auth context
