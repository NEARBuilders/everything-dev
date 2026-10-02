# 09: Owner intent flow (tracer bullet)

**What to build:** Port the owner intent pipeline end-to-end: generate-intent,
submit-intent, and status. The signed-in session binds to an owner wallet on first use —
the NEAR account from SIWN, or EVM/passkey owner descriptors — and every generate/submit
validates that the session owns the agent before acting. Correlation IDs persist per
application user and agent; interrupted generations are recoverable via the idempotency
key. Demoable outcome: a signed-in user creates an agent with one wallet signature,
end-to-end in dev.

**Blocked by:** 07 (agents-core), 08 (scaffold the agents plugin).

**Status:** ready-for-agent

- [ ] Signed-in user generates, wallet-signs (NEP-366 / NEP-413 payloads signed exactly
      as returned), submits, and polls an agent_create to SUCCESS
- [ ] Session↔owner binding persisted; a second user cannot touch another user's agents
- [ ] Idempotency keys dedupe; expired unsigned intents fail per the wire contract
- [ ] Preview data returned alongside every generated intent for UI display
- [ ] Status long-polling works with waitMs semantics
