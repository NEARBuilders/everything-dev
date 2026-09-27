---
"ui": patch
---

Rebuild the dashboard shell on shadcn's `Sidebar` primitive and fix the double-header layout bug introduced by the earlier auth-guard/dashboard-layout route split.

- Replaced hand-rolled `AppShell`/`AppSidebar`/`AppHeader`/`MobileTabBar` with shadcn's `Sidebar`/`SidebarProvider`/`SidebarInset` composition (Radix flavor, adapted to this project's React 19 function-component + `data-slot` conventions). Sidebar defaults expanded with icon+label, collapsible to icon-only via trigger or `cmd+b`.
- Mobile navigation is now the sidebar's built-in off-canvas sheet, replacing the persistent bottom tab bar.
- Split `OrgSwitcher`/`UserNav` into shell-appropriate variants: compact avatar dropdown for non-sidebar shells (`OrgSwitcher`, `UserNav`), full `SidebarHeader`/`SidebarFooter` row versions for the dashboard (`SidebarOrgSwitcher`, `SidebarUserNav`) — both share session/org/profile/sign-out logic via a new `useIdentity` hook.
- Reverted an interim "global header" experiment that caused a double-header render on dashboard routes (sidebar not spanning full height, breadcrumb bar visually disconnected from the identity nav above it). `UserNav` moved back into `PublicShell`'s own header for non-sidebar routes (`/`, `/things/*`, `/login`, `/things/new`).
- Added `Breadcrumb` (shadcn primitive) to `AppHeader`, replacing plain `account / path` text with proper `BreadcrumbLink`/`BreadcrumbPage` semantics.
- Rebuilt `NetworkToggle` on shadcn's `ToggleGroup`/`ToggleGroupItem` instead of raw template-literal ternary classes; moved from `components/ui/` to `components/layout/` (app-specific, not a generic primitive).
- Added `ui/toggle.tsx`, `ui/toggle-group.tsx`, `ui/breadcrumb.tsx`, `ui/sidebar.tsx` shadcn primitives.

No URL changes. The auth-guard vs. dashboard-layout route separation from the prior change (`_authenticated`/`_admin` as pure guards, `_dashboard` pathless layout for chrome) is unaffected — this only changes what renders inside it.
