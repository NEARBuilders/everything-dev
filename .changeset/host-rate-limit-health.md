---
"host": minor
---

Retune the edge rate limiter for practical use:

- General budget raised from 300 to **2000 requests / 15 min** per client — normal browsing (page navigations, API calls, SSR renders) no longer brushes the cap, especially behind shared NAT/VPN egress.
- New **mutation tier** (60 / 15 min, `RATE_LIMIT_MUTATION_MAX`) for non-GET requests outside the oRPC (`/api/rpc/`), Better-Auth (`/api/auth/`), and MCP (`/api/mcp`) transports — brute-force protection on direct REST writes without touching sessions, procedures, or agents (those layers own their throttling).
- `x-forwarded-for` keying now trusts only the **last** hop (the address our proxy appended) — a client can no longer mint unlimited keys by rotating a spoofed first hop.
- A rate-limited **document navigation** now returns a styled HTML retry page instead of raw JSON, so a saturated browser session sees a "please wait" screen, not a broken site. API requests keep the JSON body and `Retry-After`.
- `GET/HEAD /health` is exempt from both tiers — infrastructure probes never consume a client's budget.
