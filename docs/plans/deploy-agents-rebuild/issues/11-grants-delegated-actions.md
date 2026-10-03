# 11: Grants + delegated actions

**What to build:** Port grants and delegated execution. Grant issue/revoke with the
credential commitment stored server-side and the grant token encrypted at rest — one
grant per session, assistant, or bot. Delegated actions (swap, withdraw, transfer,
shield, unshield, confidential deposit, deposit, sign-message) enforce every applicable
control in order: grant (action, exact destination, expiry) → OutLayer policy → USD
budget → timelock — with refusals naming the blocking layer, and revocation surfacing
committed correlation IDs for work already committed to dispatch.

**Blocked by:** 09 (owner intent flow).

**Status:** ready-for-agent

- [ ] Grant issue/revoke complete with one owner signature; commitments match the documented scheme
- [ ] Grant tokens are encrypted at rest and never returned by any route
- [ ] Grant-scoped swap/withdraw/transfer execute within policy and budget
- [ ] Out-of-scope action or recipient is refused with the correct per-layer error code
- [ ] Revocation stops future work; committed work surfaces committedCorrelationIds with truncation flag
- [ ] Budget charge lands at dispatch commitment in the same transaction (no concurrent over-cap)
