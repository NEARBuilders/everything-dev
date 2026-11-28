---
"every-plugin": minor
---

Plugin workspaces can publish additional type surfaces beside their contract: declare `"every-plugin": { "additionalExports": ["src/auth-export.ts"] }` in package.json and the build compiles each source to `types/<name>.d.ts`, emits it beside the bundle, and stamps `additionalExports: [{ path, exports, sha256 }]` into `plugin.manifest.json`. Remote consumers (`fetchAuthExportTypes`) already read that field — the auth plugin ships `src/auth-export.ts`, so scaffolded children stop typechecking ui against `Auth = any` stubs once the auth plugin republishes.
