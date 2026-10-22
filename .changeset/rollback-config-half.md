---
"api": minor
"ui": minor
---

Deploy console rollback, config half (ADR 0035 decision 3, plan 055 ticket 04): a `hosting.rollback` api route republishes the config snapshot at a chosen block height with the CLI's full verification semantics — pinned-slot SRI checks, refuse rather than half-execute, `rolledBackFrom` stamping — and the config + audit manifest ride one atomic `__fastdata_kv` write signed by the runtime's own key (`ROLLBACK_PRIVATE_KEY`, `hosting.rollback { account, gateway }` variables; absent → the route refuses). Own namespace only. The `/deploys` page gains a rollback button (own-namespace rows) with confirmation and refusal surfacing. The instance half (restart against the rolled-back pin + drift marker) is ticket 06.
