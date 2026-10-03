---
"ui": patch
"api": patch
"@everything-dev/proposals-plugin": patch
---

Pin the node lifecycle prototype to the organization: the node slug is now the active organization's slug (read-only), the team wallet is the DAO linked to the organization via the new inline connect-and-link flow (`linkDao`), and form state resets when the organization changes. Conflict preflights against `resolveTenant` (by DAO) and `resolveTenantByOrgId` turn the previous mid-run 409s into upfront blockers, and an org that already owns its node resumes instead of failing. A Refresh phase can unwind the endowment's stake and delegation (unstake, withdraw, release pool, clear delegations), admins get a cleanup panel that rejects superseded node applications (the proposals plugin now allows rejecting approved proposals that were never applied, and the prototype records apply failures via `markApplyFailed`), the misleading "add members on trezu" hint only renders on DAO-membership blockers, and organization creation gains live slug availability checking with a shared `suggestAvailableSlug` numeric-suffix helper. The apply/provision paths drop the platform audit-seat enforcement and the DAO-membership rejection now names the missing member and links to the DAO's Trezu members page.
