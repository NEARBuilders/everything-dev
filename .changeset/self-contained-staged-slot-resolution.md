---
"every-plugin": patch
"everything-dev": patch
---

Self-contained image boots its own staged bytes + Docker Hub frontend flake fix

Three fixes from the release-upgrade CI failures (run 37995405819):

- **Staged-slot preference (`everything-dev`)**: when a runtime stages its own namespace under `BOS_BUNDLE_DIR`, a config slot resolves from the staged dist's own `versions/*.json` manifest instead of the config's pin whenever the pinned manifest file is absent from the staged namespace. Previously, a pin that predated the image (deploy lag after a release bump of `every-plugin`) resolved its stale hashed remoteEntry from the CDN with a 200 — the MF `loadShare` then threw `Version X from host … needs Y` and every plugin failed to load (`/api` 503). The image now boots its own bytes (ADR 0020 "cold boots need zero network"); slots absent from the staged namespace (the template plugin, registry-tier children) keep the pinned/network path, and a pinned manifest that IS staged keeps its SRI verification.
- **SharedIdentity guard for hashed entries (`every-plugin`)**: `fetchRemoteIdentityManifest` normalized only a literal `remoteEntry.js` suffix, so production hashed-entry remotes (`remoteEntry.<hash>.js`) probed `<entry>/mf-manifest.json` → 404 → the guard silently skipped verification. It now strips any `remoteEntry.*.js` suffix, so a stale-deploy load is refused with the `bos mf check` remedy instead of a cryptic `loadShare` version error.
- **Bundle URL→staged-path shared mapper (`everything-dev`)**: `bundleUrlToLocalPath` now delegates to a new `bundleUrlToStagedPath` (namespace taken from the URL itself), also used by the staged-slot preference; behavior is unchanged for identity-checked resolution.

Ops: the runtime image Dockerfile drops its `# syntax=docker/dockerfile:1.7` directive — BuildKit's built-in frontend covers the features used (`RUN --mount` needs 1.2+), removing the Docker Hub frontend pull whose `auth.docker.io` 504s flaked the regression suites.
