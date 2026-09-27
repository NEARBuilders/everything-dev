---
"everything-dev": minor
---

Config pipeline is Effect-native (ADR 0009 §6): `loadResolvedConfig`, `resolveRuntimePlugins`, and `buildRuntimeConfig` run as `Effect.fn` cores with a typed error channel — `Schema.TaggedError` classes (`ConfigLoadError`, `CircularExtendsError`, `ConfigNotLoadedError`, `ConfigNotfoundError`, `ConfigExtendsError`, `ArtifactGenError`) replace thrown `Error` strings, all with identical messages and `instanceof Error`, so no caller changes. Exported signatures stay Promise-based (bridges); the `*Effect` exports are available for Effect callers. `code-artifacts.ts` gains the same treatment (`generateCodeArtifactsEffect`). Behavior-preserving: resolution outputs, warning discipline, and cache side effects are pinned by the existing suite.
