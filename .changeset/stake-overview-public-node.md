---
"ui": minor
"api": patch
---

- Public node page `/n/$slug` now shows live stake stats (total staked, fee, pool accounts, and a ranked sample of up to 50 accounts) per resolved validator, including inherited staking pools.
- Keep stake links, show loading and unavailable states, and link to network-specific explorers.
- Resolve child-node overview URLs and keep child navigation within the overview. Parent-scoped links distinguish duplicate city slugs; unscoped lookup preserves root URLs and avoids selecting an arbitrary duplicate child.
- Preserve the selected node ID when entering staking and returning from sign-in.
