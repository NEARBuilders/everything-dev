---
"every-plugin": patch
---

UI manifest construction no longer crashes SSR composition when a single plugin route lacks a `routeConfig` loader. A missing loader now logs a `[Compose] skipping route ... — no routeConfig loader` warning and drops just that route (and its subtree) from the composed tree, so one plugin's stale or partial `routeConfig.gen.ts` can no longer take down the whole site. The digest is computed over manifests, not routeConfig, so the parity check still passes for the surviving set.
