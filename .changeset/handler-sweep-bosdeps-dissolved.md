---
"everything-dev": minor
---

Handler sweep: every bos command group now lives in `handlers/` as Effect `.effect()` generators that yield their services; the `commands/` directory is deleted. The `BosDepsTag` grab-bag dissolved into real `Context.Service` tags — handlers yield `ResolutionSessionService` (the nullable plugin-bootstrap session), `DatabaseBindings`, and `DrizzleKit` directly. All subpaths are facades or unchanged; `./cli/init` and the `handlers/*` modules keep their surfaces, and `resolveRemoteConfigChain` moved to `handlers/config`.
