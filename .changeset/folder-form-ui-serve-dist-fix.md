---
"every-plugin": patch
---

Fix the folder-form no-watch UI static server: it derived the dist directory from `path.dirname(cwd)` — serving `<parent>/ui/dist`, a directory that does not exist for plugins under `plugins/<id>/` — while the generated rsbuild config (correctly) writes `<cwd>/ui/dist`. Every asset 404'd, so the browser's manifest-driven remote registration failed and client composition silently fell back to the core-only route tree (plugin routes like `/login` and `/settings` vanished into the `_public/$accountId` catch-all). The server now also fails loud at listen time when the built UI dist is missing.
