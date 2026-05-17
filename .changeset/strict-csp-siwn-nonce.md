---
"host": patch
"ui": patch
---

Tighten the host CSP in production by switching to nonce-based script loading with `strict-dynamic` while keeping `unsafe-eval` for Module Federation. Also pass the host-provided CSP nonce into the NEAR auth client so wallet iframe scripts continue to run under the stricter policy.
