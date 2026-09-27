---
"ui": minor
---

UI reset & simplification — strip platform cruft, surface the CityNodes product.

- Landing page reset: hero now asks "What are CityNodes?" with explainer copy; the root-node directory list is kept (cards with Globe icon); account-badge pill and "Get started" CTA removed; new Apply button links to the internal `/apply` route.
- New `/apply` route that externally redirects to `https://citynode.app/apply` (structured for a per-tenant apply page to replace the redirect later).
- Apps browser removed: deleted `/apps`, `/$accountId/apps`, and the apps tab from the account profile layout — platform cruft outside the CityNodes flow.
- Things index refactored into a typed `DataTable<Thing>` demo with `ColumnDef` columns (id, type, created, updated, view action), wired to `apiClient.template.listThings`.
- Mobile responsive fixes: removed double safe-area padding on `auth-shell` main (the fixed MobileTabBar already handles the inset); added `min-w-0`/`shrink-0` guards to `simple-header` to prevent overflow on narrow viewports.
- `README.md` rewritten as the CityNodes product explainer (rendered by the about page's README fetcher); `skill.md` rewritten for the simplified CityNodes route structure.
