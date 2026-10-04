---
"everything-dev": minor
---

Authored `bos.app.ts` is now the canonical config form. `findConfigPath` prefers `bos.app.ts` over a legacy `bos.config.json` when both coexist — a generated write-back file can no longer shadow the authored descriptor.

Publish fixes for TS-form projects:

- Config-only `bos publish` no longer crashes with ENOENT when no `bos.config.json` exists. It resolves the authored config via the resolution session and merges authored hand-edits over the currently published FastKV config (child-wins), so live bundle URLs and integrity carry over while authored edits win. Removing a slot from the authored config still requires `bos deploy`, which regenerates the payload from scratch. When the registry read fails (unreachable — as opposed to a genuine first publish), config-only publish aborts instead of publishing a URL-less payload that would wipe live bundle URLs.
- The deploy train no longer writes the URL-injected config back to the authoring root for TS-form projects — pipeline state stays in FastKV. Legacy JSON-form children keep the existing `bos.config.json` write-back.
- The FastKV registry key remains `apps/<account>/<gateway>/bos.config.json` (unchanged wire format).

Config-mutating commands (`bos plugin add`/`remove`, `bos upgrade`, `bos registry use`) now write the authored form: TS-form projects are edited in place via the descriptor serializer (authored leaf + delta, no inherited values baked in); JSON-form children unchanged, except `plugin remove` of a parent-inherited plugin now writes a null-sentinel override (the descriptor form cannot express removal, so TS-form projects get explicit guidance instead). Swept hardcoded `bos.config.json` paths to the form-aware helpers (`bos status`, `bos mf check`, shared-deps, bundle-fetch identity) and neutralized "No bos.config.json found" error wording (shared `MISSING_CONFIG_MESSAGE`).
