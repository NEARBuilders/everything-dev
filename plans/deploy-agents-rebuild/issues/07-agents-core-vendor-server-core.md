# 07: agents-core — vendor the framework-free server core

**What to build:** Vendor the framework-free server core from the upstream repo's server
sources — sponsor pool, wallet sponsor, policy sponsor, prices, token catalog,
maintenance, owner proofs, nonces, crypto, errors, audit/history retention — into a new
private workspace package. These files have zero web-framework imports; the only
adaptation is replacing direct environment access with injected options. No logic
changes.

**Blocked by:** 06 (vendor the five domain packages).

**Status:** ready-for-agent

- [ ] Core services instantiate with injected configuration — no app-shell or env coupling
- [ ] Upstream SHA recorded; diffs against upstream remain purely mechanical
- [ ] Sponsor key handling and secret rotation paths preserved verbatim
- [ ] Typecheck and lint green under the repo toolchain
