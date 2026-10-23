---
"everything-dev": patch
---

Template hygiene: AGENTS.md and plugin template teach the v2 pnpm world (#454/#456). The scaffolded AGENTS.md gains the ADR 0026 never-use-bun rule (CI fails on `bun.lock`) and a docker-daemon-hangs troubleshooting line; `plugins/_template/README.md` no longer teaches `bun install`/`bun run dev`, points standalone dev at `pnpm`, references the generated rspack config instead of a hand-authored one, and sends plugin authors to the authored descriptor (`bos.app.ts`, or `bos.config.json` in JSON-form projects). A new integration test scaffolds a full child project and runs `biome check .` with the scaffolded config, so sync-owned files stay lint-clean by construction.
