---
"everything-dev": minor
---

Handler-seam cleanup around the #844 sweep

- `bos upgrade --json` / the result contract gains a `cancelled` status: declining the interactive plan (`Write? no`, or ctrl-c) reports a cancelled result through the normal pipeline instead of calling `process.exit` from inside an Effect generator. Exit code stays 0; the renderer prints "Upgrade cancelled — nothing was written".
- The dead `cli/snapshot.ts` and `cli/upgrade.ts` re-export shims are deleted — importers (handler, the upgrade plan, five tests) resolve `services/scaffold/{snapshot,upgrade}` directly.
- The `typesGen` handler moves out of `handlers/upgrade.ts` (~705 → ~515 lines) into its own `handlers/types-gen.ts` — pure move, registered identically in the plugin router.
