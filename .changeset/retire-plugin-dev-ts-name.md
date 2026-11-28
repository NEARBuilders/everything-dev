---
"every-plugin": major
"everything-dev": major
---

Retire the `plugin.dev.ts` dev-overlay name — every unit's dev overlay is `bos.dev.ts`, matching the root form. The plugin dev server and the core-ui workspace detection fail loud when only the legacy `plugin.dev.ts` exists, and `bos upgrade` renames it automatically (original preserved under `.bos/sync-backup/`; canonical wins when both exist). The scaffold template, framework-owned inventory, child-owned-block splice, tsconfig includes, and test setups all ship the new name. Children on the legacy name must run `bos upgrade` (or rename by hand) before the next `bos dev`.
