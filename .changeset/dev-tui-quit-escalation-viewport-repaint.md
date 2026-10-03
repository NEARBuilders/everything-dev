---
"everything-dev": patch
---

The dev TUI's quit path escalates like signals do: the first `q`/Ctrl+C (or `l`) starts the polite shutdown with the 5-second force-exit timer armed, and a second press force-kills even when graceful teardown is wedged — previously the quit path succeeded the shutdown deferred without any timer and swallowed every further key press, so a hung teardown froze the terminal with no escape. The terminal (cursor, alt-screen, raw mode) is also restored on every exit path, including force exit.

The interactive repaint is now viewport-bounded: the frame is capped to the terminal height (log tail trims to fit), lines are clipped to the terminal width with ANSI-aware truncation, and repaints no longer clear the whole screen (`\x1b[H` + erase-below instead of `\x1b[2J`) — long log lines no longer overflow the alt-screen into scrollback.

Also fixes a pre-existing typecheck failure in `service-descriptor.ts` (the `SERVICE_CONFIGS` record indexing made every lookup possibly-undefined under `noUncheckedIndexedAccess`, breaking the descriptor spreads).
