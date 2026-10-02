---
"ui": minor
---

The endowment re-stake flow runs from a member session without Trezu: the POC's endowment treasury field is now a typed input (the Trezu connect is a secondary action), the node name prefill uses the organization's `metadata.name` when set (falling back to the title-cased org name) and an empty saved draft no longer swallows it, the Endowment chain-state tab shows the lockup's available-to-stake balance (account balance minus the 2 NEAR storage reserve), the Sponsor NEAR field gains a Max fill of that available minus 1 NEAR, and the stake precheck refuses to stage a `deposit_and_stake` proposal larger than what the lockup can actually stake. The team unstake/withdraw dialog's Max fill now leaves the same 1 NEAR margin.
