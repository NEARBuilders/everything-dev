---
"everything-dev": minor
---

The approved boot snapshot's wire schema ships as the `everything-dev/snapshot` subpath (ADR 0041): a persisted, verified serving state — runtime ref, authorizing manifest tag, pointer fingerprint, the resolved published config, the pinned-remote mirror, and the deploy-record key — written on adopt so a restart can serve the approved composition during a registry/CDN outage. Schema and path helpers only; the coordinator and boot-path wiring follow in the boot-snapshot sprint's next tickets.
