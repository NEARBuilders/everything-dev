---
"ui": minor
"@everything-dev/auth-plugin": minor
---

Rebuild the CityNode UI on its own design system.

- Primitives move to shadcn's `base-maia` style (preset `b3ZN5L2h44`) on Base UI, with Phosphor icons, self-hosted Inter/Geist fonts, oklch tokens and larger 44px controls. Radix, lucide, clsx and tailwind-merge are removed; `cn` comes from shadcn's `cn` package.
- `@shadcn/lint` is enforced through oxlint (layout-only `className` on components, semantic tokens, no arbitrary values). Every native control is now a design-system primitive.
- Every route is rebuilt around its task: one signed-in shell with task-first navigation and named breadcrumbs, Home "Next steps", a real landing page, Explore with list/map, community and event pages, stepped Start a community and tenant creation flows, a simpler Stake flow, Organizations and Community settings with row menus and confirmations, a focused Admin, a guided node lifecycle, and a redesigned sign-in, onboarding and Settings in the auth plugin.
- Fixes: dates render only on the client (SSR/browser timezone mismatches remounted pages), org page tabs are URL-addressable, Button-as-link keeps link semantics, non-admins are told why they were sent Home, and page titles use the runtime app name.
- `ui/DESIGN.md` documents the system.
