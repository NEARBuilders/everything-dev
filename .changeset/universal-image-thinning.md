---
"everything-dev": minor
---

Deploy-identical dist builds, unified bundle resolution, pin-enforcement fix

- `bos deploy` workspace builds are now dist-first with no source maps (DEPLOY=true) — the same mode the universal image's dist-builder uses, so image bytes and CDN-uploaded bytes are built identically.
- The universal image's prod-builder prunes node_modules to the union of every workspace's production dependency closure (dev-only-deletion; nothing hand-curated).
- The bundle fetch interceptor resolves own-namespace URLs with one layered policy — staged disk → network — so a partially-staged namespace boots over the wire instead of 404ing; own-namespace misses never touch the write-through cache (stays scoped to foreign namespaces). Template-plugin dist leaves the image and loads from the CDN as a consequence (ADR 0021 amendment).
- Pin enforcement no longer fires on configs without a production form — the image's baked boot fallback no longer crashes `bos start` under NODE_ENV=production before the registry fetch runs.
- CI gains a runtime-image smoke gate: boots the built image the way production does (env identity → published config → staged bundles), asserts health/SSR/API + `bos mf check`, and prints image size.
