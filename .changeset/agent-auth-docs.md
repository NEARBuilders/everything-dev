---
"everything-dev": patch
---

Document the agent authentication story where agents actually load it: the `talk-to-the-app` skill is now the canonical brief — every API surface (REST, RPC, **and MCP including `tools/list`**) requires a session or API key and 401s anonymous callers; credential paths are the Settings UI, `bos login` (device-flow API key persisted in `.bos/session.json`), `bos login --key` (publish FC key), device-link session tokens, and CI/headless key reuse. The `cli-reference` skill gains `bos login`/`bos logout` and documents `bos publish --wallet` and `key generate --remove-old-keys`. Child-scaffold generators (`buildChildSkillMd`, `buildChildLlmsTxt`, `buildChildAgentsInstructions`) fix the wrong `edk_` key prefix (real: `api_`), add the `bos login` path, and advertise the `/skills/` tree children serve but never linked.
