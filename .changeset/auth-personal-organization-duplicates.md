---
"everything-dev": patch
---

auth: stop creating duplicate personal organizations when metadata or slug drifts off the canonical form (#877)

`findPersonalOrganization` matched only the byte-exact pair `slug = userId AND metadata = '{"isPersonal":true}'`,
while the lenient `isPersonalOrganization()` predicate accepted either signal. An organization whose metadata
was non-canonical JSON (pretty-printed, extra keys) or whose slug had been renamed was invisible to the finder,
so the `user.create` hook silently created a second personal organization on the next signup/session — observed
in production as users with multiple personal orgs plus dangling `user.last_active_organization_id` /
`session.active_organization_id` pointers.

The finder now resolves the personal organization with the lenient signals:

- `slug = userId` (unchanged), or
- metadata containing a top-level `"isPersonal": true` flag **and** the user holds a membership in that organization.

Matches are deterministic (`created_at asc, id asc`, limit 1), so historical duplicates converge on the oldest row
instead of generating new ones. `ensurePersonalOrganization` still writes the canonical metadata string on create;
nothing about creation changes.

Two deliberate hardenings beyond the literal issue proposal:

- The metadata signal is matched with a text pattern, not `metadata::jsonb->>'isPersonal'`. The column is
  `text` and better-auth stores raw strings when callers pass non-object metadata, so a bare cast would throw
  on malformed rows — inside the `user.create` hook, that breaks every signup on the deployment.
- The metadata branch is bound to the user through a membership check. An unbounded `metadata isPersonal OR slug`
  predicate would let any user's lookup match any other user's personal-flagged organization.

The orphan sweep keeps its strict canonical-only deletion query on purpose: widening it to the lenient signals
would delete non-canonical organizations that may hold user data.
