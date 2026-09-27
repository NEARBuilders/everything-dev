---
"everything-dev": minor
"every-plugin": minor
---

Complete folder-form plugin UI sources: a `ui/` directory with route files but no own `package.json` is now built entirely by the plugin's `every-plugin dev`/`build` (a generated rsbuild config under `.every-plugin/`), replacing the separate plugin-ui workspace.

- Dev orchestrator passes `BOS_UI_PORT` to the plugin dev process — including the auth app slot, whose `plugin:auth` descriptor is never spawned — so the plugin ui dev server always listens on the port the runtime config advertises (previously it auto-picked a port, breaking client-side compose of plugin routes)
- Folder-form ui builds output to the ui source root's `dist/` (web + `ssr/` containers), matching what the host's local SSR container server and manifest reads expect
- Generated rsbuild config now carries a `deployLabel`
- `bos dev` warns and suggests a single restart when its build step finds the everything-dev dist stale — the running CLI keeps the previously imported build, so orchestrator changes are one session behind without it
- New `csr` browser-regression mode (`regression:start:csr` / `test:regression:browser:csr`): the dev stack without `--ssr`, running a focused spec set that pins client-side manifest composition of plugin routes (including a no-CSP-violation assertion) — the default dev path was previously untested by the regression suite
