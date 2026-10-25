---
"everything-dev": minor
---

The interactive dev renderer emits a machine-readable raw-mode-ready pin (`\x1b]bos;ready\x07`) once stdin raw mode is enabled and the key handler is attached. Regression harnesses driving the TUI under a pty can wait on that pin instead of guessing a settle window after the alt-screen mount — typed bytes (`q`, Ctrl-C) are guaranteed to reach the key path when it appears.
