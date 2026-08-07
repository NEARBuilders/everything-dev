---
"ui": patch
---

Reorder the tenant creation pipeline to create the Better-Auth organization *before* the irreversible NEAR subaccount, and roll back the org if subaccount creation or tenant registration fails. Add `parentHasFullAccess` and `minDeposit` subaccount config to the SIWN auth runtime variables.