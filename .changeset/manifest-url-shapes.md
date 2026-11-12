---
"every-plugin": patch
"everything-dev": patch
---

Manifest documents compose by shape, not by name. Hash-named mf-manifest documents (the immutable bytes a version pin names) were invisible to every fixed-name URL guard, so a pinned host boot fetched the hashed manifest document, composed a relative public path, and the Node federation runtime prefixed `https:` onto `/remoteEntry.<hash>.js` — DNS-looking-up the file name and dying with "fetch failed" in every production-mode boot (the rc.44 release gate failure). The manifest fetch hook now normalizes any manifest document (fixed or hash-named, both layouts) with absolute SSR public paths, remote type inference, tenant UI entry resolution, SRI entry keying, and shared-identity verification all recognize both naming regimes through one shared shape helper, and the Node entry composition chain is guarded by a unit test that reproduces the failure mode.
