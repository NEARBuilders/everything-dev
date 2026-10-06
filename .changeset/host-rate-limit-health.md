---
"host": minor
---

- Rate limiter exempts `GET/HEAD /health` — Kubernetes probes no longer consume a client's request budget.
- `proxiedFetch` forwards Hono `env`/`executionCtx` to the app fetch instead of dropping them.
- Defensive error formatting in federation/plugin/MCP error paths.
