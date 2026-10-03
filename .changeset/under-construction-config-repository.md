---
"ui": minor
---

`UnderConstruction` outlinks now resolve from the runtime config context instead of a hardcoded fallback: the widget links to `repository` from the injected config (or the caller-provided `runtimeConfig`) — e.g. `repository` + `/blob/main/<sourceFile>` — and becomes inert (no tooltip link affordance, no navigation) when no repository is configured. Explicit `url` props are unaffected. Removes the silent fallback to the parent platform repository (`nearbuilders/everything-dev`).
