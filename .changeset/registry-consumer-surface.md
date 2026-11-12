---
"everything-dev": minor
---

The registry primitive's consumer surface: a new `everything-dev/registry` export
(the typed key model, the one transport, the resolution machine behind
`RegistryClient`), and `plugins/registry` becomes the typed consumer surface —
discovery/claims/metadata re-pointed onto the client, new `getManifest` and
`resolveRuntime` routes, and the client composed in-process via `servicesTag`
(host/api/plugins consume it without HTTP). The tsdown entry for the new subpath
ships with the export, so production-conditions builds (containers, plugin bundles)
resolve it the same way development does.
