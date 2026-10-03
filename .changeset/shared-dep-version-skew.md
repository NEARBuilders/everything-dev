---
"host": patch
"every-plugin": patch
---

Establish strict version identity for Module Federation shared dependencies to eliminate silent Effect-RC cross-bundle skew.

The effect-critical shared deps (`every-plugin`, `effect`, `@orpc/contract`, `@orpc/server`, `@orpc/client`, `@orpc/experimental-effect`), now carry exact `requiredVersion` (the installed version) with `strictVersion: true`, single-sourced from every-plugin's shared-deps module across bundle-time, runtime pre-registration, and the host build. `bos mf check` compares bundle versions exactly for these deps and treats non-caret constraints as exact matches. The plugin loader rejects a remote whose mf-manifest.json shared identity disagrees with the local runtime (`BOS_MF_IDENTITY=warn` opts out to warn-and-load), and skipped plugins surface in /api/_health with full detail. Deploy workflow gates Railway redeploys on `bos mf check` so an inconsistent release train fails CI.
