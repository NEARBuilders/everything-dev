---
"everything-dev": patch
"host": patch
---

Deploy folder-form plugin uis and harden SSR composition against ui-less remotes.

- **Folder-form plugin ui deploy**: `bos publish --deploy` now uploads `<plugin>/ui/dist` (web `remoteEntry.js` + `ssr/remoteEntry.server.js`) as its own bundle key (`<key>-ui`) and pins `<slot>.<key>.ui.production` / `.integrity` / `.ssr` / `.ssrIntegrity` in `bos.config.json`. Previously these fields were never written, so a deployed plugin ui (e.g. `app.auth.ui`) resolved with an empty production URL and production boot crashed.
- **SSR composition guard**: the host skips plugin ui sources with no production URL (logged warning naming the plugin) instead of crashing SSR composition with `TypeError: fetch() URL is invalid` from a relative `/mf-manifest.json` fetch.
- **Config resolution guard**: a remote ui target with no URL drops out of runtime resolution entirely instead of resolving to `{ source: "remote", url: "" }`.
