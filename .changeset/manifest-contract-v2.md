---
"every-plugin": minor
"everything-dev": minor
"host": patch
---

Manifest contract v2 (ADR 0024): route records adopt the TanStack virtual-file-routes vocabulary — `type: "route" | "layout" | "index"` replaces the `isLayout`/`isIndex` booleans — and the manifest version is enforced at every load: the host's manifest loads and the client's compose-payload parse reject a skewed major with one diagnostic (a version-skewed payload degrades to the core-only tree instead of silently mis-constructing). The folder-form ui's composition key now derives solely from the `plugins/<key>` layout — a non-derivable key fails the build loudly instead of silently falling back to the container name (the drift that mis-keyed manifests). Mount registry version bumps to 5, invalidating all compose digests once.
