# 0029. Agent surface split — connect UX, operating surface, and model tools

Date: 2026-10-15
Status: Proposed

## Context

PR #403 ships `agentConnect` in `better-near-auth`: seven hand-curated Better Auth
endpoints (`agent/create`, `agent/intents/submit`, `agent/status`, `agent/list`,
`agent/grants/issue|revoke|list`) behind Better Auth `sessionMiddleware`, with
session↔agent↔intent ownership checks, a persisted idempotency ledger, and grant
tokens encrypted at rest — a thin adapter over the hosted NEAR Intents Agent API,
funneled through one SDK seam (`src/agent-api.ts`).

The deploy-agents-rebuild sprint (Stream B, tickets 06–13) vendors the engine
in-process as `plugins/agents` — its own dedicated database, its contract generated
from the vendored wire contracts ("identical public API surface to the upstream
control plane… no hand-copied duplicates"). Ticket 13 fixes the auth model:
"session-authenticated for owner routes, grant-scoped for delegated actions."

Left unexamined, the two efforts collide in three ways:

1. **Surface conflation.** Owner connect/sign UX, the platform operating surface,
   and the model-facing tool surface have different credentials and different
   audiences; nothing yet assigns them to distinct layers, so each new capability
   (executions, MCP agent tools, EVM owners) risks being bolted onto whichever
   surface happens to exist.
2. **Double ledger.** #403's `agent_account` / `owner_intent` / `agent_grant` tables
   live in the auth plugin's database, while ticket 08 gives `plugins/agents` its own
   dedicated database. Without a stated rule, two stores both claim to be the record.
3. **Unfiltered MCP.** The host MCP server generates one tool per OpenAPI operation
   with no per-tool or per-permission filtering — any authenticated session or API
   key sees the entire catalog. The moment agents-plugin routes merge into the api
   shell router, swap/withdraw-class operations become visible to every broad key.

The upstream Agent API's own guidance points the same direction: owner intents
(policy, grants, freeze, delete) belong to the owner's UI with a wallet signature and
must never become model tools; the model gets a small read/quote/execute surface
gated by grants; your database is "a cache plus your retry ledger," never the
authority.

## Decision

1. **Three surfaces, one engine.** Every agent capability belongs to exactly one of:

   - **Connect Surface** — `better-near-auth` `agentConnect`. Credential: session +
     wallet/passkey signature. Scope: `agent_create`, grant issue/revoke, intent
     signing and submission — the owner-controlled lifecycle, packaged as a library
     any Better Auth consumer can adopt.
   - **Operating Surface** — `plugins/agents`. Credential: session for owner routes,
     grant for delegated routes. Scope: the contract-generated control plane (reads,
     lifecycle, executions) built on the vendored engine.
   - **Model Tools** — the MCP subset generated from the Operating Surface's OpenAPI
     spec. Credential: grant, one per MCP client. Scope: balances, rules, tokens,
     quotes, swap/transfer/withdraw — never owner intents.

2. **Two-ledger rule.** The engine's dedicated database is the source of truth for
   policy, grants, custody, and execution state. The auth plugin's agent tables are
   the session↔agent↔intent binding, the idempotency/retry ledger, and encrypted
   grant-token custody — a cache plus ledger, never the authority. `runIntent`'s
   persist-before-send ordering defines the ledger discipline either way.

3. **Permission layering.** The app's config-declared permissions (ADR 0028) gate
   *reachability* only — who may touch the agent surface at all. The owner-signed
   policy bounds *capability* — what any agent can do regardless of app role. Grants
   are per-actor credentials the app credential *selects* (the server decrypts and
   injects the right grant) but never *carries*. Refusals name the blocking layer:
   app permission → grant → policy → budget → timelock.

4. **Exposure principle.** Operating Surface routes are generated from the vendored
   wire contracts with declarative per-operation gates (credential class per
   operation, config-declared). An undeclared operation is invisible — default-deny,
   ADR 0028's "undeclared means denied" applied to surface generation. Role changes
   become catalog edits, not endpoint code. Owner-intent operations are session- and
   wallet-gated by construction and are never exposed as model tools.

## Open

The durable role of #403's endpoint layer once the vendored engine lands — keep as
the owner UX atop the engine (the `agent-api.ts` seam swaps in place), supersede it
with the `plugins/agents` contract surface, or split by credential — is deliberately
unresolved here. Sprint ticket 16 (decision, `ready-for-human`) settles it before
tickets 08–09 start; this ADR is amended to Accepted (or restructured) with the
outcome.

## Consequences

- **MCP filtering becomes a prerequisite.** No agents-plugin route may merge into the
  api shell router before the MCP server filters tools by effective permissions —
  sprint ticket 17 gates ticket 13.
- **Role changes stop changing code.** Admin vs member vs agent maps to which grants
  they can mint/revoke and which declared operations they reach — data in the
  permission catalog, not new endpoints.
- **#403's generic machinery survives either fork outcome.** `runIntent`,
  `mapAgentApiError`, the ownership guards, and grant encryption are surface-neutral
  and are reused wherever the Connect Surface lands.
- **Two databases stay coherent** because the two-ledger rule assigns authority
  explicitly; sync is one-directional (engine → auth tables) and best-effort with
  fail-loud on ledger writes, matching #403's ordering rule.
- Hand-curated endpoint authoring (~6 touch points per upstream endpoint) is bounded
  to the Connect Surface's seven interim endpoints; the Operating Surface's growth is
  absorbed by generation plus declarative gates.
