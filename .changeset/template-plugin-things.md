---
"@every-plugin/template": patch
"ui": patch
---

Route the things UI through the namespaced `template` plugin client and enforce auth on thing writes.

- Things routes in the UI now call `apiClient.template.createThing`, `apiClient.template.getThing`, `apiClient.template.deleteThing`, and `apiClient.template.listThings` instead of the removed top-level `api` client methods; `live.tsx` no longer needs a cast to reach the template client
- The template plugin's `createThing` and `deleteThing` handlers now use the `requireAuth` middleware instead of manual `context.userId` checks, so unauthorized write attempts fail with a typed `UNAUTHORIZED` error
- Removes the `api.dependsOn: ["template"]` wiring from `bos.config.json` since the parent API no longer proxies thing routes
