---
"every-plugin": patch
---

FixMfDataUriPlugin now resolves what it rewrites. The data-URI normalizer strips machine-absolute `node_modules` prefixes from generated runtime imports (MF runtime, rsbuild's HMR entry) and records each bare specifier's on-disk target, then redirects resolution back through a NormalModuleFactory `resolve` tap. This replaces the hardcoded `mfDataUriAliases()` list, which missed specifiers it didn't know about — `@rsbuild/core@2.2.8`'s exports map doesn't expose `./dist/client/hmr.js`, so any workspace with a browser dev build (ui, auth, ai) failed with `Package subpath './dist/client/hmr.js' is not defined by "exports"` immediately after "Rspack compiled successfully". Module ids stay machine-independent: the request remains the bare specifier; only the resolution target is machine-specific.
