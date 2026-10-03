---
"everything-dev": major
"every-plugin": minor
---

The slot pin gets an explicit representation: config slots carry
`pin: { manifest, integrity }` (the versioned WorkspaceVersionManifest
filename + that document's SRI) instead of the overloaded flat pair — the
top-level `integrity` is now always a direct entry SRI, only for unpinned
fixed-name slots. Breaking: the flat `manifest` key is retired (deploy
write-backs scrub it), and outside development every remote slot MUST pin a
version manifest — an unpinned remote slot fails config resolution loudly
(pre-pin configs are pre-atomic-deploy and not servable). Fixed-name entry
fallbacks are development-only at every consumer (host html shell, head
scripts, SSR entry loads, compose webEntry); a production slot without a
derived `entryUrl` fails loudly. Extends merge treats the pin atomically (a
child pin replaces the parent's whole). Also adds `resolveEntryUrlForEnv`
to `every-plugin/ui/manifest` — the shared consumer contract for entry-URL
resolution.
