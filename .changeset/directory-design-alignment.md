---
"ui": minor
---

Redesign the public directory pages and align chrome/components on the landing style.

- Landing page (`/`) is now left-aligned and minimal: "What are City Nodes" heading with lede copy, a "Directory" section rendering nodes as a borderless single-column table (hairline row dividers, `hover:bg-muted/50` + name underline), and a left-aligned Apply CTA. Healthy top spacing below the header bar (`pt-12 sm:pt-20`).
- New shared pathless `NodeDirectory` component (`n/-node-directory.tsx`) owns the directory table, skeleton rows, and empty state, with optional validator badges.
- Node page (`/n/$slug`) adopts the same language: `NodeDirectory` for child nodes (with validator badges), de-carded stake section (primary Button for own-validator, borderless hover rows for city stake links), matching skeleton/not-found states, and `default` container width.
- Canonicalize `UserNav`/`NearBranding`/`ThemeToggle`/`OrgSwitcher` under `components/layout/`: `_public.tsx` and `auth-shell.tsx` now import the layout copies (the ones with ThemeToggle + outline-variant connect button), the barrel re-exports the layout copies, and the stale root-level duplicates are deleted.
- Replace remaining hand-rolled inline-class buttons/links with `Button` variants across dashboard, admin, tenant, orgs, and things pages (including `icon-sm` outline back buttons), and swap a hardcoded rgb avatar border in orgs/$slug for the semantic `border-border-strong`.
