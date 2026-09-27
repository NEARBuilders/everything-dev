---
"everything-dev": minor
---

UI route grafting foundation: grafted ui-plugin composition, digest-cached SSR compose, plugin ui SSR fields, mf-build shared surface

Adds `everything-dev/ui/compose` (`composeApp`, mount registry, deterministic graft order, staticData.nav manifest, digest helper, compose cache) and `everything-dev/ui/mf-build` (`createUiSharedDeps` catalog-enforced singleton list, `pluginUiDeployFields`, engine entries) subpath exports. `plugins.<id>.ui` gains `ssr`/`ssrIntegrity` fields so plugin ui remotes contribute server route-tree exposes; the core `ui` remote now also exposes `./tree` for grafting. Host gains `services/ui-compose.ts` (digest-keyed composed tree cache wired into the SSR handler — opt-in via `BOS_UI_COMPOSE=1` until grafted-route client composition ships) and CSP origins for plugin ui remotes.
