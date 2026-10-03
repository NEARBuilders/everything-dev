---
"everything-dev": major
"host": major
"ui": major
"@everything-dev/auth-ui": major
---

Manifest composition replaces route-tree grafting as the composed-SSR model (plan 034, ADR 0007/0008). The host constructs the ENTIRE route graph from generated manifests (`manifest.gen.json` + `routeConfig.gen.ts` per ui source) through the core ui's `./compose` engine; `defineUiPlugin`, the `./tree` expose, `composeApp`/`graftCopy`, the v1 mount registry, the homegrown digest, and the dedicated `ui-ssr`/`plugin-ui-ssr` dev servers are deleted. `bos dev --ssr` now composes from source manifests in the host process (no extra servers or probes); `BOS_UI_COMPOSE` is gone. Client runtime config changes shape: `ui.compose` is now `{ digest, remotes: [{key, name, entry}], manifests }` and `ui.composeDigest` is removed. Plugin ui remotes consume shared deps with `import: false` (the core provides); mounts are registry v2 (`public`/`authenticated`/`admin` implemented, `org`/`team` declared) and root-level pathless layouts.
