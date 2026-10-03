---
"ui": patch
---

The `?? "citynode.app"` gateway default is gone from all seven route sites (`_public/index`, `_public/n/$slug`, `_public/stake`, `apply`, the staking POC lifecycle, proposal review, tenant wizard). Every gateway now derives from the runtime config via the new `getGatewayId()` accessor (`@/app`), which returns null when the config is missing or mis-shapen — routes then render an explicit error state, disable dependent queries, or fail the mutation with a clear message, instead of silently impersonating the platform gateway. Node directories link through a node's own hostname when present, and the tenant wizard's "Extends" row shows the configured gateway rather than a hardcoded one.
