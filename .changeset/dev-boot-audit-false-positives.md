---
"everything-dev": patch
---

Dev-boot composition audit stops flagging coherent rc.38 children (surfaced by the opencrosspost.com boot — three divergence lines whose named repairs could never clear them):

- Subpath singletons (`everything-dev/ui/auth`, `everything-dev/ui/i18n`) resolve through their base package's installed version when probed locally. The subpath has no own package.json or catalog row, so every child's ui/auth-ui remotes — whose bundles embed the subpath in their shared maps — printed `everything-dev/ui/auth@unknown` divergences forever, and the audit's own repair instructions (`bos deploy --packages ui` / `bos upgrade`) were no-ops for the actual half of the comparison.
- The auth mirror (`plugins.auth`, added by config.ts mirroring `app.auth` as the plugin runtime's compose surface) no longer reports "missing from the release composition — it composes live, unpinned bytes" when the manifest records `app.auth`: the mirror composes app.auth's pinned bytes, and a recorded `app.auth` covers it. A mirror over an unrecorded `app.auth` is still a genuine provisioned line.
