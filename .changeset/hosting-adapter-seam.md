---
"everything-dev": minor
---

Adds the `HostingAdapter` seam and its Docker dev-substrate implementation (`everything-dev/hosting`, `everything-dev/hosting/docker`): the platform's single substrate-independent surface for operating runtime instances — deploy a digest-pinned image with `BOS_ACCOUNT`/`BOS_GATEWAY` identity env, health-gate on `/health`, observe, restart, stop. Alchemy is the control plane (in-process `Deploy.deploy`, local state ledger); no substrate resource types, ports, or networks cross the seam. First slice of the ADR 0035 deploy console.
