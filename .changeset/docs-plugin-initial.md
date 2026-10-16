---
"@everything-dev/docs-plugin": minor
---

Initial release of the docs plugin — docs-as-code over the repository's own markdown.
Velite compiles `docs/**` and `GLOSSARY.md` at build time through a rspack
`beforeCompile` hook (appended via every-plugin's `extraPlugins` build.config.ts
option); a read-only oRPC router (`listPublished`, `getBySlug`) serves the compiled
content, and a gate-free public UI (`/docs`, `/docs/<slug>`) renders it in the app
shell with client-side markdown rendering (react-markdown + shiki). No database, no
secrets.
