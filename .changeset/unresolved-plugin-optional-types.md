---
"everything-dev": patch
---

Generate optional `PluginsClient` properties for unresolved `api.dependsOn` plugins.

When `api.dependsOn` references a plugin that isn't registered in the configuration,
the generated `PluginsClient` type now includes an optional property with a generic
`ClientFactory<AnyContractRouter>` signature, instead of silently dropping the
dependency. This allows the API entry point to use optional chaining
(`plugins.pluginKey?.()`) without type errors.

Previously, an unresolved dependency caused `PluginsClient` to be typed as
`Record<string, never>`, which combined with `noUncheckedIndexedAccess: true` in
the API's tsconfig produced TS18048/TS2722 errors on any direct access to the
dependency.
