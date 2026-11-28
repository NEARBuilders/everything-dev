---
"every-plugin": minor
---

Content collections as a framework primitive (ADR 0052): a workspace with a `velite.config.ts` compiles its collections inside its rspack build automatically — the framework owns the compile step and the watch scoping (collection-pattern watcher instead of velite's unfilterable recursive watch, which crashed past the file-watcher limit on repository-root content). `plugin.manifest.json` self-describes non-code resources by convention (`content: { compiler: "velite" }`, `docs: { dir: "docs" }`), and compiled collections ride the dist as `content/<name>.json` artifacts — uploaded, diffed, and SRI-pinned by the deploy train's generic file machinery. `content: false` in the base-config options opts out for hand-wired `extraPlugins`.

---
"everything-dev": minor
---

The runtime map inventories content sources (ADR 0052): `.content` in `runtime-map.json` and `RUNTIME_CONTENT_SOURCES` in the TS emission — the composing app's docs tree (`app`, mounted `/`), each local plugin workspace's `docs/` dir (`plugins/<id>`), and remote plugins declaring `docs.dir` in their manifest.
