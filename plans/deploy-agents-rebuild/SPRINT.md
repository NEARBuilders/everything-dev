# Sprint: deploy-agents-rebuild

One initiative, two streams, fifteen tickets. Shared tag: this folder.

## Goal

1. **Deploy consolidation** — collapse every deploy path into one `bos deploy` command
   (preflight → build → upload → publish → confirm → universal image → digest-pinned
   Railway deploy), wire CI to it cleanly, delete the cruft.
2. **Agents rebuild** — vendor the NEAR Agent API domain engine into this monorepo and
   rebuild the control plane as `plugins/agents`, so their standalone server never needs
   to run. The platform's auth, DB conventions, deploy train, and MCP surface close
   around the same wire contract.
3. **Upstream convergence** — after both land, propose the high-leverage changes back
   to NEARFDE/near-intents-agent-api: core-package extraction + session-based partner
   auth first, then the full "adopt the plugin as the root server" pitch.

## Streams and branches

- Stream A (tickets 01–05): branch `chore/consolidate-deploy`
- Stream B (tickets 06–13): its own feature branch
- Stream C (tickets 14–15): upstream, gated behind Stream B completion

## Dependency graph

```
01 ── 02 ── 03 ── 04 ── 05 ─┐
                            ├── 13 ── 14 ── 15
06 ── 07 ──┐                │
       08 ──┴─ 09 ── 10 ── ┤
              │──── 11 ────┤
              │──── 12 ────┘
```

- 06 and 01 can start immediately in parallel.
- 13 is the join point: the plugin ships on the consolidated deploy train.
- 14 and 15 are the upstream proposals, strictly last.

## Sources

- Domain engine upstream: `NEARFDE/near-intents-agent-api` (private; vendoring at a
  pinned SHA, refresh = re-copy — see ticket 06)
- ADRs 0020 (bundle storage/CDN) and 0021 (universal runtime image) govern the deploy train
- Trust-model decisions: sponsor keys live in-process as plugin secrets; dedicated
  database for the agents plugin (auth-plugin precedent)
