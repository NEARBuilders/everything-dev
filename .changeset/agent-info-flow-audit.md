---
"ui": patch
"host": patch
"everything-dev": patch
---

Audit and fix agent information flow for first-load discovery.

- Rewrote `ui/public/skill.md` with two explicit agent modes: talk to the app via MCP/REST (with API key auth instructions), and clone & modify (with AGENTS.md reference, architecture notes about Module Federation code bundles, and regression test info).
- Expanded `ui/public/llms.txt` to include API, MCP, auth, and repository source sections.
- Added `/.well-known/mcp.json` host route for MCP discovery (server name, endpoint, transport, auth scheme).
- Deleted stale `LLM.txt` (superseded by AGENTS.md).
- Created `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md` to resolve dangling AGENTS.md references.
- Added agent communication surface section and `.agents/skills/` workflow skills mention to AGENTS.md.
- Added `/settings/api-keys` route with API key create/list/delete UI and API Keys tab in settings layout.
- Exposed auth and plugin router routes as MCP tools (in addition to base API) in `mountMcpRoute`.
- Updated `buildChildAgentsInstructions` in init.ts with MCP/API-key sections and "remotes are code bundles" note.
- Added child `llms.txt` and `skill.md` template generation in init.ts `personalizeConfig`.
- Added MCP endpoint regression test (`mcp_test.go`), agent surface content tests (`agent_surface_test.go`), and browser test for settings API keys page.
