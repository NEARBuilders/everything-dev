---
"everything-dev": patch
---

Fix dev boots with folder-form plugin UIs: the port planner's unit list included standalone `plugin-ui:*` units the session descriptor map folds into their plugin's dev process (`BOS_UI_PORT`), so every folder-form boot named a unit the orchestrator could never resolve and crashed at startup. The planner now mirrors the session map's folder-form folding. `BOS_READINESS_DEADLINE_MS` can also stretch the per-unit readiness window — default windows assume warm builds and a cold first boot on a loaded machine can outlive them.
