---
"everything-dev": patch
---

Adopt the Effect idioms left after the lint cleanup (port of citynode.app#328): `timedPhase` (Effect.fn + Clock + Effect.exit) replaces the async `timePhase` internals — `ProgressEvent` drops its unused `message` field; `isDebug` consolidates the ad-hoc `DEBUG` checks; `devBootstrap`/`startBootstrap` drop the `BootstrapHelpers` injection (the module-level `resolveProxyUrl` is called directly); host compose, federation, and plugin loading convert to `Effect.fn` generators; core and plugin route configs share one `routeConfigLoaders` validation (a routeConfig expose missing it now fails loudly, including for core ui loads); `enforceCacheLimit` generalizes to the stored value type so the compose variants cache uses it.
