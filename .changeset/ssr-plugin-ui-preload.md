---
"everything-dev": minor
---

Emit preload hints for composed plugin-UI remotes in SSR pages via new `getRemotePreloadLinks()` from `everything-dev/ui/head`. Plugin remote entries and their browser manifests were previously discovered only after the core remoteEntry executed and hydrate registered remotes, serializing document → remoteEntry → manifest → remoteEntry. The preload link attributes match the MF runtime's own load modes (plain no-cors script for entries, cors fetch for manifests) so the browser reuses the preloaded responses.
