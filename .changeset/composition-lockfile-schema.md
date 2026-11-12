---
"everything-dev": minor
---

The composition lockfile's wire schema ships as the `everything-dev/lockfile` subpath (ADR 0042): `bos.lock.json` freezes one runtime's exact composition — the pinned descriptors and bare plugin refs in walk order, optional shared-singleton and contract records, and a fingerprint that equals the pointer fingerprint of the frozen config and recomputes from the stored record alone. Schema and path helpers only; the `bos lock` producer and boot consumer follow in the composition-lockfile sprint's next tickets.
