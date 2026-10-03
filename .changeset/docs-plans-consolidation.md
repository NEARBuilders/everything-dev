---
"everything-dev": patch
---

Consolidate the plan tree under `docs/plans/`: merge `advisor-plans/` (the advisor audit queue) and `plans/` into one directory — audit plans sit flat, thematic subdirectories (beta-v2, wayfinder, prototypes, deploy-agents-rebuild, extensions, infra, offline, v1-current) and `done/` hold the rest. Plans markdown is now first-class tracked (the old `plans/` gitignore regime silently dropped new files). Rewrite the `/improve` skill to write plans into `docs/plans/` (advisor-plans fallback removed). Fix stale `metadata.sources` in the `api-and-auth`, `plugin-development`, and `ui-integration` skills, and point the scaffolded AGENTS.md text at `GLOSSARY.md` (renamed from `CONTEXT.md` to match the upstream skill ecosystem).
