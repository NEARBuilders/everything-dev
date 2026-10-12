---
"everything-dev": patch
---

Three export subpaths shipped pointing at unpublished `./src/` files — `./fingerprint`, `./version-manifest-resolve`, and `./ui/version-check` — so every consumer outside the monorepo (notably child repos, whose scaffolded `ui/src/components/version-refresh-banner.tsx` imports `everything-dev/ui/version-check`) failed to resolve them at typecheck and runtime. All three now follow the canonical exports shape used by every other subpath: a `development` condition mapping to `src` plus dist fallbacks (`./dist/*.d.mts` / `.mjs` / `.cjs`). Release staging also now fails loudly when any export target still points at `./src/` after development conditions are stripped, instead of publishing a dangling path.
