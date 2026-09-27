---
"ui": minor
---

Consolidate app shells and align every route on one chrome + width system.

- All layouts now use the shared layout components: `_layout.tsx` renders the extracted `<BetaBanner/>`; `_public` and `_anon` both render `PublicShell` (logo-left, UserNav-right header + NearBranding footer), with `_anon` passing `showConnect={false}` so the login page hides the connect CTA; `_authenticated` and `_admin` render `AppShell` (`AppSidebar` + `AppHeader` + `MobileTabBar` driven by `NAV_ITEMS`), replacing the monolithic `auth-shell.tsx`, which is deleted. The desktop icon rail gains an `orgs` entry, matching the mobile tab bar.
- `UserNav` accepts `showConnect` (default `true`) to hide the connect button while keeping theme/network toggles.
- Login page simplified: no brand element, no anonymous session option, single primary "connect with NEAR" CTA (with "Continue as …" when a wallet is detected), rendered in the same public header as every other public page.
- Page widths are now consistent per shell: public children `default` (max-w-4xl), authenticated/admin children `wide` (max-w-6xl) — stake, apply, orgs/new, invites, things/new, tenant error state moved up; `admin/tenants/new` no longer double-nests a container inside the admin layout's.
- `/dashboard` is now a layout route owning the wide `PageContainer` (mirroring `admin.tsx`), with its content moved to `dashboard/index.tsx`. URLs are unchanged.
- The components barrel exports the full layout family (`AppShell`, `AppHeader`, `AppSidebar`, `MobileTabBar`, `BetaBanner`, `PublicShell`, `UserNav`, `NearBranding`, `NAV_ITEMS`, role helpers).
