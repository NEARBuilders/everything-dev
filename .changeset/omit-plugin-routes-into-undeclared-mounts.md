---
"every-plugin": minor
"everything-dev": minor
---

An attached plugin mounting into an area the runtime does not declare is now omitted with a compose log line instead of failing the whole composition — the runtime map generator mirrors the engine (`every-plugin/ui/manifest` construct + the codegen static model), so starter levels that strip a mount (simple drops `_authenticated`) no longer break `bos types gen`, `bos dev`, or SSR for children inheriting plugins that target it. Core ui sources keep the fail-loud throw: a mount typo in the runtime's own ui is still a config error.
