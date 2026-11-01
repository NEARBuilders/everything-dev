---
"everything-dev": minor
---

Published payloads never carry `local:` dev targets — children inherit consumable slots (#584)

Publish canonicalization strips `local:` development refs (app slots, auth/`auth.ui`, plugins and their ui sub-slots) from the published config. A `local:` target is workspace-relative — it resolves only in the repo that declares the workspace, and a child inheriting one could never spawn it. The authoring surface (`bos.app.ts`) keeps its own refs for the parent's own `bos dev`; `extends` now hands children only consumable targets, so a freshly scaffolded child with no local auth workspace runs `bos dev` and loads the auth plugin (server + UI) from its published bundle with no dev override. The runtime's existing production-fallback behavior (`resolveDevelopmentTarget`) is covered end to end by an integration test (runtime slot + dev-harness derivation + planner port allocation).
