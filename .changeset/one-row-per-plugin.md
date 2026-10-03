---
"everything-dev": minor
---

One row per plugin in the `bos dev` service table: `plugin-ui:*` companion rows merge into their parent as an inline `· ui :<port>` annotation (the `auth` app slot shows as one PLUGINS row, e.g. `AUTH (local) running :3002 · ui :3011`), SERVICES lists only host/api/ui, and a merged row counts as ready only when both its api and ui surfaces are ready. Auth-mirror detection now exists in exactly one shared helper (`isAuthMirrorPluginEntry`) — the inline copies in the infra planner, DAG, and api contract bridge are deleted.
