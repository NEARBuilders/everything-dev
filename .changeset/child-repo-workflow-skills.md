---
"everything-dev": minor
---

`bos init` now scaffolds the agent workflow layer into child repos: `.agents/skills/` (the mattpocock workflow skills verbatim — grill → spec → tickets → implement/tdd → code-review — plus the repo-authored `everything-dev-app` orientation glue skill), `docs/agents/` tracker/triage/domain conventions, and `skills-lock.json` provenance. All of it is framework-owned under `bos sync` (updates with upstream drift, child-added skills left untouched). The child `AGENTS.md`, `skill.md`, and `llms.txt` surface the workflow skills so a fresh agent session discovers them unprompted.

Also fixes `bos init` crashing on TS-form children (`bos.app.ts`): shared-deps sync and config resolution no longer require a `bos.config.json` that the authored-config conversion intentionally removes — the init flow passes the converted config explicitly and tolerates resolution before the first `bun install`.
