---
"everything-dev": patch
"every-plugin": patch
---

Platform compat never lies (issue #546): workspace version manifests now record the shared-singleton versions each build embedded (`shared`), slot resolution stamps them onto UI slots, and the host's SSR composition guard refuses to load a split module graph with a named sources-and-versions error instead of the federation runtime's cryptic negotiation error. `bos mf check` gains a UI composition gate (sibling UI slots cross-checked), `bos platform manifest --check` reports pin drift as "parent platform is X, you pinned Y", deploy builds stamp `MF_BUILD_VERSION` so `buildInfo.buildVersion` advertises the true platform release, and the publish train refuses when uploaded bundles disagree with the release manifest's pins (stale install).
