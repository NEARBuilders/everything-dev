---
"everything-dev": minor
---

Runtime map gains the backend inventory — host, api, auth server, and plugin backends (#594 review)

The composition inventory now covers the serving side, not just the ui sources: the map's `backends` section lists the host (source-level — it ships no manifest asset), the api shell, the auth server, and every plugin backend with its workspace path (local) or composed `pluginVersion` + `contractSha256` (remote, from the published `plugin.manifest.json`). Same loud-degradation semantics as ui sources (strict in `bos types gen`, warn on boots, `BOS_MAP_ALLOW_UNRESOLVED=1` offline). The map also records the runtime's `platform` pin and `extends` chain, and the TS surface gains `RUNTIME_BACKENDS`. A parity test runs the real `constructTree` engine over fixture manifests and diffs the composed full-path sets — the static model cannot drift from the engine. Investigation workflows (ownership lookups, shadow detection, drift alarms, change placement) live in `docs/agents/runtime-map.md`.
