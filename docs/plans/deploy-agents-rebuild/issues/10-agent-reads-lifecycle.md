# 10: Agent reads + lifecycle

**What to build:** Port the agent reads — list/get, wallet, balances (public and
confidential), policy and policy history, limits, budget, timelock, scheduled
executions, and the token catalog — and the lifecycle intents: policy_update,
budget_set, timelock_set, freeze/unfreeze, archive/restore, and delete with its deletion
preview. All reads are scoped to the session's bound owner; each lifecycle intent
completes with exactly one wallet signature.

**Blocked by:** 09 (owner intent flow).

**Status:** ready-for-agent

- [ ] Every read is scoped to the session's owner; cross-owner access is refused
- [ ] Each lifecycle intent completes with one wallet signature and confirms via status
- [ ] Policy revision conflicts surface the documented revision error (read → regenerate flow)
- [ ] Deletion preview carries beneficiary, retirement mode, and assets-lost data
- [ ] USD budget windows report limit, spent, remaining, and resetsAt per the contract
- [ ] Balances use raw/decimal token fields exactly as the contract specifies
