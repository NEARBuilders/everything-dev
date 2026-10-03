# 13: Ship the plugin + verify the MCP surface

**What to build:** The join ticket. Verify the agents plugin rides the consolidated
deploy train into the universal image, mf check is green with the new plugin in the
federation set, and the MCP tool surface is generated from the plugin contract with the
right auth model — session-authenticated for owner routes, grant-scoped for delegated
actions. Document the agent client usage (owner flow, delegated flow, MCP) for the
platform docs.

**Blocked by:** 05 (deploy stream complete), 10 (reads + lifecycle), 11 (grants +
delegated), 12 (invariant suites).

**Status:** ready-for-agent

- [ ] Deploy train ships the plugin; mf check passes with it in the federation set
- [ ] MCP tools generated from the contract and callable against staging
- [ ] Owner routes require a session; delegated routes require a grant — verified
- [ ] Platform docs cover owner flow, delegated flow, and MCP usage with signing semantics
- [ ] Staging holds the plugin with dedicated database and secrets configured
