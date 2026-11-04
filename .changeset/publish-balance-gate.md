---
"everything-dev": patch
---

The deploy preflight checks the publish account's balance before building: a publish whose account cannot cover the gas prepayment now fails in seconds with the exact amounts and a top-up hint, instead of dying hours later as a silent "dropped at broadcast". Broadcasts surface the pool's admission verdict (`NotEnoughBalance`, stale nonce) at submit time instead of fire-and-forget, registry writes attach 30 Tgas instead of 300 Tgas (shrinking the prepayment lock 10×), and the function-call key allowance floor follows.
