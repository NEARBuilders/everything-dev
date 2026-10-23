---
"everything-dev": minor
---

#537 — `/.well-known/version` now answers a `build` object with the serving build's identity: `frameworkVersion`, `everyPluginVersion`, `gitSha`, and `image.ref`/`tags`. The git sha rides the platform release manifest (optional `gitSha` field) composed identically in both publish homes — the FastKV publish train (deploy HEAD) and the in-image staging (`ARG BOS_GIT_SHA` build arg; CI and the local deploy train pass it, regression builds omit it and the field drops). The host remote can't read the in-image manifest file (its import URL is a CDN bundle), so the CLI orchestrator resolves it once at boot and injects it into the host server. Also fixes the latent `/.well-known/version` bug where the Effect promise was handed to `c.json()` un-awaited, serializing an empty object.
