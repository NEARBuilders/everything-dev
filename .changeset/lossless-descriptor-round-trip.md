---
"everything-dev": patch
---

Lossless descriptor round-trip: keep `starter` and remote-only `api` slots

Two fixes in the same guard class as the earlier remote-only auth attachment drop:

- The child's authoring-only `starter` level survives the save-path round-trip (`bos plugin add/remove`, `bos config registry use` no longer silently delete it from `bos.app.ts`); resolved configs still strip it, and JSON parents' starter *block* metadata is untouched. (#565)
- A remote-only `app.api` entry (authored `variables`/`secrets`, no local workspace) survives `configInputToDescriptor` instead of being dropped — the `slot()` helper required `development` for all three slots; only host/ui are path-strict. (#566)
