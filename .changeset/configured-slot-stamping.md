---
"everything-dev": patch
---

Release-scoped slot stamping no longer skips a slot the child only configures. A child that sets `auth: { variables, secrets }` (or a remote-only `api: { variables, secrets }`) had that slot counted as authored, so the deploy train left it unpinned and the auth server (or api) kept following the parent's live config pointer — under a host and auth UI pinned to the child's release. A slot now counts as authored only when it names a code source (`production`, `development`, `pin`, `extends`, `proxy`, a bare plugin ref, or `ui: false`); configuration-only entries get the release's `production` + `pin` stamped with their `variables`/`secrets` kept. Affected children pick this up on their next deploy after upgrading.
