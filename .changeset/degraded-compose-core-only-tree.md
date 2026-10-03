---
"everything-dev": patch
---

Client compose degradation builds a real core-only route tree. When client composition
failed (a plugin remote's chunk load error, a digest mismatch) the hydrate bootstrap
passed `routeTree: undefined` to `createRouter`, leaving the router's `routesById`
unset — every page then crashed with `Cannot read properties of undefined (reading
'__root__')` instead of degrading. Compose failure or digest mismatch now constructs
the core-only tree from the payload's core manifest plus the app route config and
client-renders it (never hydrates over SSR'd composed HTML); a router created without
any tree fails loudly at creation instead of crashing cryptically during render.
