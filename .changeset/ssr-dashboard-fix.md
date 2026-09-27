---
"everything-dev": patch
---

Fix misleading "UI-SSR running" dashboard line when SSR is off.

- Gate the `ui-ssr` service descriptor in `buildServiceDescriptors` on `runtimeConfig.ui.ssrUrl` being truthy, aligning the planner path with `service-descriptor.ts` which already correctly omits `ui-ssr` when `ssr === false`.
- Previously the planner always added `ui-ssr` to `orchestrator.packages` (it only checked `resolvedPorts.uiSsr`, which is always allocated), so the orchestrator treated the missing descriptor as a "Remote" service and immediately marked it `ready` — printing "UI-SSR running" even though no `bun run dev:ssr` process was spawned.
