---
"host": patch
"everything-dev": patch
---

Fix `/api/mcp` silently failing to mount when any operation input contains a `$ref` (#670).

- Tool input schemas are now self-contained. Referenced `components.schemas` entries are copied into `$defs`, and their refs are rewritten, so recursive inputs such as `z.json()` compile.
- A tool whose input schema still fails to compile is logged and skipped, and the rest of the MCP mounts. Previously, one bad operation dropped the whole route to 404.
