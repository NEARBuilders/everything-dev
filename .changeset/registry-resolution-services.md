---
"everything-dev": minor
---

Registry and resolution restructured under `services/` (ADR 0031) — **subpaths moved, update your imports**:

| Old subpath source | New source |
|---|---|
| `src/fastkv.ts` | `src/services/registry/fastkv.ts` |
| `src/fingerprint.ts` | `src/services/registry/fingerprint.ts` |
| `src/dag.ts` | `src/services/registry/dag.ts` |
| `src/resolver.ts` | `src/services/resolution/resolver.ts` |
| `src/merge.ts` (internal) | `src/services/resolution/merge.ts` |
| `src/resolution/session.ts` | `src/services/resolution/session.ts` |
| `src/federation.ts` | `src/services/federation.ts` |

The `./fastkv`, `./fingerprint`, `./dag`, `./resolver`, `./federation`, and `./resolution` export entries now point at the new locations (built dist paths updated). `./config` stays put: the 1.5k-line config module split by concern into `services/resolution/{load,validate,serialize,runtime}.ts`, with `src/config.ts` as the public barrel re-exporting the identical surface — `./config` consumers are unaffected. Merge semantics (`bosConfigMerger`, `mergeBosConfigWithExtends`, `rebuildOrderedConfig`, extends-ref resolution) are unchanged and pinned by the existing merge/extends-chain tests. FastKV gains a `FastKVRegistryService` tag (reads, history, deploy manifests, bos:// URL algebra); the registry write rides the signer services. Fingerprint stays a pure module beside the registry services. Authored/resolved config behavior is identical: same entry preference (`bos.app.ts` over `bos.config.json`), same resolved-config write-back, same runtime assembly.
