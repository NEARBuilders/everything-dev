---
"every-plugin": patch
"everything-dev": patch
---

Introduce typed Effect errors across host, CLI, and plugin runtimes. `every-plugin`'s `Plugin.initialize` contract now types its layer error channel as `Error` and its failure channel as `PluginRuntimeError` (mapped via `toPluginRuntimeError`), and `PluginRuntimeError` exposes a readable message. `everything-dev` gains exported `OrchestratorError` and `encodeRuntimeConfig` — `BOS_RUNTIME_CONFIG` is now schema-encoded with undefined fields omitted (undefined array entries become null) instead of raw `JSON.stringify` — plus tagged error conversions in migrations, preflight, integrity, near-cli, and storage-upload, and schema-validated migration journal loading.
