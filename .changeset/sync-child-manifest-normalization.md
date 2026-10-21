---
"everything-dev": patch
---

Sync and upgrade no longer break child installs with the parent's `workspace:^` specifiers (#521): every manifest the sync write path produces is normalized into child shape — `workspace:` specifiers for cataloged packages become `catalog:` and cross-field dep duplication is deduped (`dependencies` wins) — covering both the updated and conflicted outcomes. Also fixes the upgrade migration phase crashing with `EISDIR` on pnpm's symlinked `node_modules` entries (glob now ignores nested `node_modules`, unreadable entries are skipped) and makes the scaffolded `bos.app.ts` biome-clean (unquoted keys) so children pass the format check verbatim (#518).
