---
"everything-dev": minor
---

Bump the platform catalog to the latest age-eligible releases: TanStack router family (react-router 1.170.46, generator 1.167.46, plugin 1.168.48, query 5.104.5), orpc 2.0.0-beta.45, react/react-dom 19.3.1 (strict singletons — floating children realign via `bos upgrade`), effect 4.0.0-rc.118 with the vendored clone retagged, alchemy 2.0.0-beta.83, better-auth stays 1.7.7 (1.7.x type drift tracked separately), module-federation 2.9.2, drizzle/zod/yaml patches. Code deltas required by the new pins: `PublisherResumeOptions.seconds` → `ttl` (ms) in orpc beta.45, and the shared RouterError now derives its props from react-router's `ErrorComponentProps`.
