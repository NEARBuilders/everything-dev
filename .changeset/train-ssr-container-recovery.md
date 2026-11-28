---
"everything-dev": minor
---

The build train's child env contract is SSR-safe (#940): `trainBuildEnv`
strips the dev-session `BOS_SSR` flag from every train build child (a
build-shape build that half-included the node env would emit hashed server
entries over a live dev container) and pairs with the every-plugin
rsbuild factory's clean-keep so the plain train preserves a running
dev:ssr stack's SSR container. Host side, `FederationContainers` /
`waitForLocalContainer` gain a bounded recovery budget and composeUi
serves the last-good generation loud when a local SSR container
transiently disappears mid-rebuild — a healthy tree never 500s while a
concurrent build rewrites the dist.

Also fixes a dev-boot crash from the boot-seam consolidation: the
orchestrator's unit list is now the spawnable service-descriptor set, so
folder-form plugin ui keys (which no service spawns) no longer crash
`unitSpecFor` at boot.
