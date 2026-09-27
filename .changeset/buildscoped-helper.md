---
"every-plugin": minor
---

Add `buildScoped(tag, layer)` and `buildScopedContext(layer)` helpers for building scoped resources inside plugin `initialize` (replaces the hand-written `Layer.buildWithScope` + `Effect.scope` + `Context.get` incantation), and export a `PluginEnv` alias for the `initialize` effect's environment (`Scope.Scope | PluginIdTag`).
