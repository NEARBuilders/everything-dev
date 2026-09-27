---
"ui": minor
---

Add the node-directory, country-aggregator, and stake-selector UI surfaces.

- Public landing page is now a directory of root nodes: queries `listRootNodes` instead of `listValidators`, renders node cards (name, kind badge, slug) linking to `<slug>.<gateway>`, with skeleton loading and a "No nodes yet" empty state.
- New public country page at `/n/$slug` acts as an aggregator: resolves the node by slug, lists direct children (`listChildren`), and renders a stake section that shows the country's own validator CTA or "stake to a city" links to children-with-validators (via `resolveStakingValidators` subtree). Includes "No child nodes yet" empty state.
- Stake page rewritten around subtree validators: queries `resolveStakingValidators(nodeId)`, renders a selectable validator list with `isDefault` pre-selected, role badges (community styled secondary), protocol badge when not `near`, an inherited-validator banner when `sourceNodeId` differs from the node, and a no-validator state with child-node links. Node is resolved from a `?node=` search param (dev-testable) or the subdomain hostname (production). Stake transaction and onramp flows are unchanged; the broken admin CRUD affordances (throwing "being redesigned") were removed — management UI lands in a follow-up.
