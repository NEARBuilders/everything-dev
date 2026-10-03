# 08: Scaffold the agents plugin

**What to build:** Scaffold the agents plugin from the plugin template: the public
contract built from the vendored wire-contract schemas (identical public API surface to
the upstream control plane), the initialize layer wiring the vendored core services as
scoped Effect services, a dedicated database via the plugin DB conventions (its own
database URL secret — the auth-plugin precedent for financial state), sponsor keys as
plugin secrets (mainnet/testnet), and OutLayer/1Click endpoints as plugin variables.
Register the plugin in the runtime config.

**Blocked by:** 06 (vendor the five domain packages).

**Status:** ready-for-agent

- [ ] Plugin loads in dev behind the host; a health route works end-to-end
- [ ] Dedicated database migrations apply (pglite in tests, Postgres in dev)
- [ ] Sponsor keys resolve from plugin secrets; absence fails with an actionable error
- [ ] Contract schemas imported from the vendored contracts package — no hand-copied duplicates
- [ ] Runtime config entry added with development local reference and secrets list
