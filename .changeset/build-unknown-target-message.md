---
"everything-dev": patch
---

`bos build` reports unknown/unsatisfiable targets instead of a bare "[CLI] Unknown error": invalid target names get "Unknown build target(s): … — valid targets: …" (framework packages build via the prerequisite train), remote-only/no-match selections get "Nothing to build — no local targets matched: …", and a missing bos.config.json says so. `BuildResultSchema` now carries the `error` field the CLI already tried to print.
