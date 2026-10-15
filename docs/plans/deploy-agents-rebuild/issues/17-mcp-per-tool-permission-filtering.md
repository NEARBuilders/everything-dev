# 17: MCP per-tool permission filtering

**What to build:** Permission-aware tool generation in the host MCP server
(`host/src/services/mcp.ts`). Today the generator emits one tool per OpenAPI
operation (skipping only missing operationIds, SSE responses, and duplicates) and
authorization is all-or-nothing — `isAuthenticated` gates the catalog, so any valid
session or API key, even one with an empty permission map, sees and can invoke every
generated tool. Per-route middleware still refuses at call time, but catalog
visibility leaks the surface and invites confused-deputy calls.

Scope:

- Operation→permission metadata flows from oRPC contract metadata into the OpenAPI
  spec (an extension attribute) so REST docs and MCP share one annotation source.
- `tools/list` filters by the caller's effective permissions (`context.permissions`
  per ADR 0028's `getContext`); tool invocation re-checks before dispatch, so the
  route middleware and the catalog never disagree.
- Decide and test the default rule for operations without declared permissions
  (default-allow preserves today's behavior for existing routes; default-deny
  matches ADR 0028's "undeclared means denied" — the choice must be explicit either
  way).
- This is a hard prerequisite before any agents-plugin routes merge into the api
  shell router (the `things` merge precedent): swap/withdraw-class operations must
  never be visible to every broad key.

**Blocked by:** none — the machinery exists today. **Blocks:** 13 (ship + MCP
verification).

**Status:** ready-for-agent

- [ ] Metadata channel decided and emitted by the OpenAPI generator; at least the agents-relevant operations annotated
- [ ] `tools/list` reflects the caller's slice; invocation re-checks permissions before dispatch
- [ ] Default rule for unannotated operations decided, documented, and tested
- [ ] Regression spec: a key with empty/narrow permissions sees a filtered catalog and cannot invoke a gated tool
- [ ] Ticket 13's checklist gains the filtering verification item
