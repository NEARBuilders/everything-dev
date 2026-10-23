---
"everything-dev": patch
---

- `bos types gen` now generates manifest/route-tree artifacts for a local auth attachment's ui (`auth.ui`), keeping artifact generation hermetic for any child with a local plugin UI override. Fixes everything-dev#549
- The dev session now spawns a `plugin-ui:<id>` unit for a local ui override whose plugin backend is remote (e.g. a remote auth server with a local `auth.ui` workspace), so the host's SSR container becomes ready instead of timing out after 120 s. Fixes everything-dev#557
- The host compose now fails loud when a declared local ui source has no usable manifest or an identity mismatch, instead of silently dropping the slot with a warning. Remote sources keep their warn-and-drop isolation. Ships via the platform runtime image. Fixes everything-dev#556
