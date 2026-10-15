---
"everything-dev": patch
---

Fix the uninstallable npm tarballs (rc.5–rc.8): `@everything-dev/upload-app` is now a devDependency of `everything-dev` — the upload client is bundled into the published dist, so the leaked `"workspace:^"` runtime dependency is gone and standalone installs resolve again. Release staging now fails the release when any runtime/peer/optional dependency still carries an unresolvable `workspace:` ref, and the integration harness no longer papers over such leaks when installing the packed tarball.
