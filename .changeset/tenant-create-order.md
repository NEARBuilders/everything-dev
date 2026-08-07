---
"ui": patch
---

Reorder the tenant creation pipeline to create the Better-Auth organization *before* the irreversible NEAR subaccount, and roll back the org if subaccount creation or tenant registration fails. Add `parentHasFullAccess` and `minDeposit` subaccount config to the SIWN auth runtime variables.

Make the FastKV config + metadata publish relayer-aware: use delegate action + relay when the relayer is configured, fall back to a direct transaction signed by the user's wallet as the new subaccount when the relayer is unavailable.