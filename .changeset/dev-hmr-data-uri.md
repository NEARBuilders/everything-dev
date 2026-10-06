---
"every-plugin": patch
---

`FixMfDataUriPlugin` now only rewrites `@module-federation/*` imports inside data-URI modules. It used to strip the absolute `node_modules` prefix from every data-URI import, which turned Rsbuild 2's dev HMR client entry (`@rsbuild/core/dist/client/hmr.js`) into a bare specifier its exports map rejects, so `every-plugin dev` failed for the UI and plugin UIs with "Package subpath './dist/client/hmr.js' is not defined by exports".
