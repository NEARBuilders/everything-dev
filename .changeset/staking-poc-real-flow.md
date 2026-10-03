---
"ui": minor
"api": minor
---

Rework the node lifecycle prototype at `/prototype-staking-poc` to mirror the real on-chain deployment flow. Twelve stations across five phases — initialize (apply, admin approve + pool assignment, admin funds the team treasury), bootstrap (publish the tenant config, stake 1 NEAR into the team-owned pool, House of Stake setup via veNEAR registration + lockup deploy + lock-all), an optional sponsor phase for the endowment (lock its NEAR, stake the pool from its lockup, delegate all its veNEAR to the team — skipped when team and endowment are one account, never blocking the team's track), the team's House of Stake vote, and a refresh phase that unwinds both sides.

Ordering is now declarative: each station lists exactly the chain facts it requires, replacing the implicit upstream walk — the bootstrap stations run in any order and a wrong requirement-blocker no longer gets overwritten. Steps carry their attached deposits, so the admin "Fund the team treasury" action computes `max(4 NEAR, remaining requirement + 1 NEAR buffer)` and the page shows the live treasury balance against the derived requirement. The vote deposit is corrected to `vote.dao`'s configured `vote_storage_fee` (0.00125 NEAR) instead of a hard-coded 5 NEAR, sensing proposals (status `Created`) are listed as votable, and a publish proposal that reports failed on trezu is treated as expected — the config-live FastKV check is the source of truth.

The prototype's inputs move to TanStack Form with per-organization localStorage persistence, so a refresh restores the draft; the staking pool is prefilled from the admin-assigned default staking validator. `applyNodeProposal` now accepts an optional `poolAccountId` and persists it as the node's default staking validator plus node metadata at approval time.
