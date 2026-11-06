---
"everything-dev": patch
---

Boot snapshots now stage for extends-chain children (#800): the authored
`app.<plugin>.ui` descriptor's `name` is optional, matching the release-scoped
stamper's canonical `{ production, digest }` form — the schema requirement was
silenty disabling snapshot staging for every child inheriting platform auth
(the stage failure surfaced as a dim `Note:` while deploys "succeeded" with no
staged generation). Resolution never consumed the authored name (the runtime
container name derives from the plugin workspace), so nothing downstream
changes. A deterministic staging failure now also prints as a yellow warning
naming the consequence ("restarts will resolve from the live registry")
instead of a dim note.
