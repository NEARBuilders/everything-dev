# 16: Decide the durable agent surface split

**What to build:** A decision, recorded by amending ADR 0029 from Proposed to
Accepted: once Stream B's vendored engine lands, what is the durable role of PR
#403's `agentConnect` endpoint layer in `better-near-auth`? The three candidate
outcomes, with their tradeoffs:

- **(a) Keep as the owner UX on top.** `better-near-auth` keeps the curated
  connect/sign/grant endpoints; `agent-api.ts` swaps to the vendored engine (the
  seam's stated purpose); `plugins/agents` owns the contract-parity operating
  surface. Two surfaces, one engine, ledger roles per ADR 0029's two-ledger rule.
  Cost: two surfaces to maintain; benefit: the reusable-library distribution story
  (any Better Auth consumer gets the connect UX) and zero churn on a merged PR.
- **(b) Supersede with `plugins/agents`.** Stream B's contract-generated surface
  replaces #403's endpoints entirely; `better-near-auth` keeps only the
  wallet-signer/passkey client primitives. Cost: churn on a merged PR and the loss
  of the library story; benefit: one surface, one shape (upstream wire contract).
- **(c) Split by credential.** Owner-intent routes stay in auth (session + wallet
  signature); delegated/execution routes exist only in `plugins/agents` (grant
  scope). Cost: capability boundaries straddle two packages; benefit: the smallest
  each-package story, matching ticket 13's auth split line for line.

The decision must also settle the two-ledger rule as written (engine DB = source of
truth; auth tables = binding + retry ledger + grant custody) or replace it.

**Blocked by:** none — this decision gates Stream B's start (blocks 08 and 09).

**Status:** ready-for-human

- [ ] Outcome (a/b/c) chosen and consequences written into ADR 0029; status Proposed → Accepted (or the ADR restructured)
- [ ] Two-ledger rule confirmed or replaced in ADR 0029
- [ ] SPRINT.md dependency graph finalized (16 removed from the frontier)
- [ ] GLOSSARY entries for the chosen surface vocabulary land
