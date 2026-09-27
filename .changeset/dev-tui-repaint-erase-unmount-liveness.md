---
"everything-dev": patch
---

Dev TUI display hardening: every repaint now erases to end of line (`\x1b[K`), so rows that shrink between frames (the ready summary, status text, log tail) no longer leave residue from earlier frames mid-row. The renderer also stops painting entirely after unmount — late log events and the final flush can no longer repaint a stale frame onto the shell after quitting — and unmount is idempotent, so calling it twice (e.g. from both `restoreView` and the session finalizer) restores the terminal exactly once. Shutdown/force-exit messages now print after the alt-screen is restored, so "[Dev] Shutting down..." is actually visible instead of being written into the TUI frame and destroyed.
