---
"every-plugin": patch
---

Core-over-plugin route/mount precedence replaces the `constructTree` collision throw
(ADR 0010 decision #1). A tenant defining a local route (e.g. `_public/login`) while
inheriting a plugin that ships the same path no longer 500s the client compose and
degrade to core-only with a user-facing toast: the core ui claims paths and mount
declarations first, and a plugin's colliding claim is shadowed — logged with a
`[Compose]` prefix naming both claimants — while its own subtree stays out of the
tree. Plugin-vs-plugin collisions on the same path or mount keep throwing loudly.
Digest inputs stay alphabetically sorted, so the composition digest and
server/client hydration parity are unchanged.
