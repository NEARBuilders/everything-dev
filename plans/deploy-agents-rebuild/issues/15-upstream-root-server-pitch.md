# 15: Upstream full pitch — adopt the agents plugin as the root server

**What to build:** The complete proposal to NEARFDE/near-intents-agent-api to adopt
`plugins/agents` as the canonical control plane, ending the standalone Hono server:

- Their demo and partner frontends become **shared-host tenants** (different /ui via
  plugin ui overrides, zero instance), **child runtimes** (own account/domain via
  extends, own extra plugins), or **pure API consumers** (same wire contract,
  platform API keys instead of distributed partner keys).
- The domain engine stays theirs: the published packages from ticket 14 remain the
  upstream they own; the platform consumes them.
- The AI-assistant surface is MCP tools generated from the contract, authenticated
  through grants.
- Includes the **org-scoped per-partner sponsor key** design (today each partner
  deployment carries its own sponsor; as a root runtime the sponsor is ours in-process —
  partner identity needs an org-scoped secret story) and a migration path off the Hono
  server.

**Blocked by:** 14 (upstream core extraction + session auth).

**Status:** ready-for-agent

- [ ] Pitch document opened upstream covering the tenant model, API-key parity,
      MCP surface, sponsor-key scoping, and the migration path
- [ ] Answers the honest costs: Next.js apps rewrite as tenant runtimes or stay API consumers
- [ ] Upstream decision recorded (accepted / rejected / needs-work) with follow-ups ticketed
