---
"everything-dev": minor
"@everything-dev/auth-plugin": patch
---

Fix auth plugin remote load by resolving its MF container name from its `plugin.manifest.json` (mirrors the resolution `plugins.*` already use). Without this, in remote mode the host registered the auth remote under the slot key `"auth"` while the container's self-name was `everything-dev_auth-plugin`, causing `@module-federation/node`'s chunk-URL fallback to silently return empty chunks and throwing `ModuleFederationError: undefined is not an object (evaluating '__webpack_modules__[e].call')` — the only plugin to fail. Bos configs can set an explicit `app.auth.name` to pin the remote name.
