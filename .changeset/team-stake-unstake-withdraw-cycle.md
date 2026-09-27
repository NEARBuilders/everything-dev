---
"ui": minor
---

The My Node team-stake card now walks the full unstake → withdraw cycle without breaking the staking pool's non-payable calls: the unstake proposal no longer attaches a deposit (the pool's `unstake`/`withdraw`/`unstake_all` methods reject any attached deposit with `ERR_METHOD_NOT_PAYABLE`), the card shows unstaked NEAR while it is locked in the ~2-day (4 epoch) release window, and once `can_withdraw` is true the same button becomes a withdraw proposal that returns the NEAR to the team treasury. The staking-POC's pool `unstake_all`/`withdraw` steps drop their 1-yocto deposits for the same reason.
