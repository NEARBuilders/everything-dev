---
"everything-dev": patch
---

Fix dev sessions being unquittable from their own terminal: Bun's TTY stdin never enters flowing mode from a bare `data` listener attach, so with the TUI's raw mode on (ISIG disabled) neither `q` nor Ctrl-C reached the key handler and no SIGINT was generated either. The renderer now resumes stdin after enabling raw mode (and pauses on unmount). Quit-path hygiene rides along: the signal handler delegates to the same shutdown path the TUI uses, emergency kill reuses `reapGroup`, the force-exit re-arm got an honest name, and `l` (export logs) no longer counts toward the quit escalation. New framework regression tests drive a real pty: press `q`, press Ctrl-C, and assert the whole stack dies.
