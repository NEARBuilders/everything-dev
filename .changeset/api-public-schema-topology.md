---
"everything-dev": patch
---

The sync-owned db layer template keeps the api on public-schema topology (`schemaName` undefined) instead of namespacing it into `plugin_api` — reconciling the layer with `bos db doctor` (checks `public`), the drizzle-kit configs (no `schemaNames`), and every v1-upgraded database. Plugin workspaces keep `plugin_<slug>` isolation. Fixes #495.
