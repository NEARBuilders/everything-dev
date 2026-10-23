---
"everything-dev": minor
---

#536 — `bos types gen` is the complete hermetic local-resolution step: it now writes `.bos/bos.resolved-config.json` (same shape `bos dev`/`bos build` write) and as a regenerable step emits the core ui route tree, so a fresh checkout matches CI after one command. `bos typecheck` materializes the resolved config the same way. Also registers the `--env` / `--dry-run` / `--remote-plugins` flag schemas so the CLI parses them and `bos types gen --help` no longer crashes.
