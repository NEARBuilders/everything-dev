---
"everything-dev": minor
---

New `./dev-log-pipeline` subpath export: the shared log-level resolver
(`resolveLogLevel`, `toEffectLogLevel`, `LogLevelEnv`) that the host's SSR
seams consume — src under the `development` condition, dist otherwise.
Pairs with the host's generation-scoped composition (ADR 0048): the
federation debug marks (expose loads with generation ids, integrity
verification, container waits) surface under the same CLI flags
(`BOS_LOG_LEVEL` / `DEBUG`) with no new env vars.
