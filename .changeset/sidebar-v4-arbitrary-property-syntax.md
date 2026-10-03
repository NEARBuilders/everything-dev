---
"ui": patch
---

Fix dashboard sidebar width not applying under Tailwind v4.

`ui/components/ui/sidebar.tsx` and the `SidebarOrgSwitcher`/`SidebarUserNav` dropdown menus used Tailwind v3's arbitrary-value bracket syntax for referencing CSS custom properties (e.g. `w-[--sidebar-width]`, `w-[--radix-dropdown-menu-trigger-width]`). Tailwind v4 replaced that syntax with the arbitrary-property shorthand `w-(--sidebar-width)` — the bracket form is no longer recognized as a variable reference, so the sidebar and its dropdown menus silently fell back to no explicit width. Updated all affected classes (including the `calc()` variants using `theme(spacing.4)`, itself removed in v4, now `--spacing(4)`) to v4 syntax.
