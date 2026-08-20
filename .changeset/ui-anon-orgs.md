---
"ui": minor
---

Add a dedicated anonymous mount and reorganize organization routes.

- Add a `/_layout/_anon` pathless layout for pre-auth pages. Move login from the public layout into it; the layout redirects authenticated users to `/dashboard` and provides the theme toggle header.
- Rename the organization route group from `/organizations` to `/orgs` (`/orgs`, `/orgs/new`, `/orgs/$slug`) and move invitation acceptance to `/orgs/invites/$id`.
- Remove the stale nostr entry from the authenticated sidebar.