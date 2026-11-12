---
"everything-dev": patch
---

Emit declaration files for the compose, snapshot, and lockfile entrypoints — the exports map pointed their `types` at dist files the dts build never produced (chunk emission ships JS without declarations), so every generated child failed `tsc --noEmit` with TS7016 on `everything-dev/ui/compose`. The build now fails loud when any exports subpath resolves to a missing dist types file, so this class of regression cannot ship again.
