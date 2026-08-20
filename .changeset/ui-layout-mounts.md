---
"ui": minor
---

Reorganize UI routes into mount-point layouts and rename the authenticated workspace.

- Move admin routes under a new `/_layout/_admin` pathless layout that gates on the admin role and redirects non-admins to `/dashboard`. The tenant admin dashboard (`admin/admin/index.tsx`) and system page (`admin/admin/system.tsx`) now render as children of the admin layout through an `Outlet`.
- Rename the authenticated `/home` route to `/dashboard`, updating the sidebar, mobile tab bar, user nav, and login redirect fallbacks.
- Move the apps and things routes under the public layout (`_layout/_public/apps`, `_layout/_public/things`) so they render inside the shared public shell instead of the top-level layout.
