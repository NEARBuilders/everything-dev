---
"everything-dev": minor
"ui": patch
"@everything-dev/projects-plugin": patch
---

Fix sidebar navigation to derive from plugin sidebar items and include projects

- Updated `ui/src/routes/_layout.tsx` to properly consume generated `pluginSidebarItems` instead of using hardcoded navigation.
- Fixed `packages/everything-dev/src/sidebar.ts` so the core `home` item points to `/home` (logo/dot still links to `/` for repository markdown render).
- Added `plugins.projects.sidebar` to `bos.config.json` so the projects plugin appears in generated navigation.
- Regenerated `ui/src/lib/plugin-sidebar.gen.ts` via `bos types gen` to include the `projects` sidebar item.
- Fixed unbalanced JSX structure in `_layout.tsx` and removed stale/unused imports.
