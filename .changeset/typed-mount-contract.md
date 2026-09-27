---
"everything-dev": minor
---

Add a typed mount contract for ui plugin grafting: `defineUiPlugin({ name, mounts, tree })` declares a plugin's ui surface against the canonical `MountId` union (derived from `MOUNT_REGISTRY`, with `MOUNTS` exported). Root `_mount` declarations are validated at construction — typos and undeclared mounts throw with the offending route id and a closest-mount hint instead of silently never grafting; raw `routeTree` exports keep working via the derivation fallback. `MOUNT_REGISTRY_VERSION` bumped to `2026-09-19.1` (invalidates all compose digests).
