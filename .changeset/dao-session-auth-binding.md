---
"ui": patch
---

Lock the Trezu DAO connection to the trezu-wallet only and bind its session to the signed-in SIWN identity: the connect flow now always targets the Trezu wallet explicitly (the near-connect selector popup — where injected wallets like HOT could appear — never opens), wallet metadata comes from the official near-connect registry so executor updates no longer require a redeploy, and the Trezu session is torn down when the auth account changes or signs out instead of silently persisting the previous login's account.
