---
"everything-dev": patch
---

Registry pointer and version-record reads no longer collapse "unreachable" into "absent". `fetchRegistryKey` now resolves `null` only for a real 404 / empty entry and rejects with `RegistryError` (`kind: "unreachable"`) when the registry cannot be read, and it bypasses the 30s GET cache so a post-publish read never serves pre-publish bytes. Consequences: the release classifier, the burned-version check and the smoke pointer check fail with an accurate diagnosis instead of acting on a guessed "nothing published", and the compat-window gate fails the train when it cannot read the pinned window instead of silently skipping it.

