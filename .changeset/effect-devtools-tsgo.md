---
"every-plugin": major
"better-near-auth": major
"everything-dev": minor
"@everything-dev/auth-plugin": major
---

Adopt the Effect DevTools toolchain: native TypeScript 7 (`@effect/tsgo`) with the Effect language-service plugin, and Oxlint with type-aware Effect rules.

TypeScript peer/dev ranges are narrowed to `^7.0.2` (no more `^5` support): `every-plugin`, `better-near-auth`, and `@everything-dev/auth-plugin` now require TypeScript 7, and `everything-dev` moves its devDependency to `^7.0.2`. Builds are unaffected (rspack/rsbuild transpile); typechecks and the editor language service run on the patched TS 7 native compiler.

TS 7 compatibility fixes: the test-plugin fixture consumes the built `every-plugin` declarations, and a new root `tsconfig.base.json` consolidates shared compiler options across parent-owned workspace tsconfigs (scaffolded `ui/`/`api/`/`plugins/*` tsconfigs stay self-contained since they are copied verbatim into child projects).

Contract declarations move into the plugin build entirely: `every-plugin build`/`deploy`/`dev` regenerate `types/contract.d.ts` from `src/contract.ts` via the patched TypeScript 7 binary whenever it is stale (rspack watch keeps dev types fresh automatically), and `EmitPluginManifest` embeds the fresh file with a verified sha256. The per-workspace `tsconfig.contract.json` files are removed — `bos sync` migrates child projects, and `every-plugin types` regenerates manually. `bos typecheck` now regenerates client-stub types itself before type-checking, so the root `types:gen` script is gone. Remote plugin-manifest fetches during `types gen` retry on transient network failures.
