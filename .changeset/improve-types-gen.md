---
"everything-dev": minor
---

Improve `bos types gen` with `--remote-plugins` flag, cleaner output, and local paths

- **`--remote-plugins` flag**: `bos types gen --remote-plugins auth,apps` forces specified plugins to fetch contract types remotely, matching `bos dev --remote-plugins` behavior. The flag is passed through from `runTypesGen` in init.ts, so `bos sync` and `bos upgrade` also benefit.
- **Cleaner output**: Replaced misleading "Mode: local|remote" (which only reflected the API source) with a "Contract sources:" section that shows each plugin's actual source. Output is now organized as "Written:" (generated files) and "Contract sources:" (per-plugin remote/local status).
- **Local paths shown**: Local contract sources now display their relative project path (e.g., `api local (api)`, `apps local (plugins/apps)`) instead of just "local".
- **Removed unused `source` field**: The `source` field was removed from `TypesGenResultSchema` and the handler since it was redundant — each contract source now reports its own status individually.
