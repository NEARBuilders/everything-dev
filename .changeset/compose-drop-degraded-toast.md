---
"everything-dev": patch
---

Drop the degraded-compose toast. A compose that degraded to the core-only tree
(dropped remote, digest mismatch, core-over-plugin shadowing) no longer surfaces an
infinite-duration "Some application features couldn't load" toast — `console.error`
and the `__CLIENT_PROGRESS__` debug channel remain the signals. The full-page
startup error UI is unchanged.
