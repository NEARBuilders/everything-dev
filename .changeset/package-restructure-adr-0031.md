---
"everything-dev": minor
---

Package restructure (ADR 0031): `everything-dev` now follows the same `contract / handlers / services` shape as every other plugin. The public subpaths are unchanged in name and surface, but several now resolve to new sources — **if you deep-import source paths, update your imports**:

| Old source | New source |
|---|---|
| `src/fastkv.ts` | `src/services/registry/fastkv.ts` |
| `src/fingerprint.ts` | `src/services/registry/fingerprint.ts` |
| `src/dag.ts` | `src/services/registry/dag.ts` |
| `src/resolver.ts` | `src/services/resolution/resolver.ts` |
| `src/merge.ts` (internal) | `src/services/resolution/merge.ts` |
| `src/resolution/session.ts` | `src/services/resolution/session.ts` |
| `src/federation.ts` | `src/services/federation.ts` |
| `src/build.ts` | `src/services/workspace/build-train.ts` |
| `src/auth-login.ts` | `src/services/auth/device-login.ts` |
| `src/near-signer.ts` | `src/services/auth/signer.ts` |
| `src/publish.ts` | `src/services/deploy/train.ts` |
| `src/cli/{init,import,sync,upgrade,snapshot}.ts` | `src/services/scaffold/*.ts` (thin facades kept — `./cli/init` subpath stable) |
| `src/commands/*` | `src/handlers/*.ts` as `.effect()` generators (directory deleted) |

Domain highlights: the deploy train is `DeployTrainService` (`services/deploy/`), the workspace build train `BuildTrainService` (staleness oracle injectable), auth flows are `DeviceLoginService`/`SessionStore`/`SignerService` behind one `SiteClient` (oRPC error envelopes now surface the server's detail verbatim), registry services behind `FastKVRegistryService`, and the `BosDepsTag` grab-bag dissolved into real `Context.Service` tags handlers `yield*` (`ResolutionSessionService`, `DatabaseBindings`, `DrizzleKit`). The contract is the single flag source — `bos <command> --help` renders flags straight from the Zod option schemas (`contract.meta.ts` is a facade). All subpath exports (`./fastkv`, `./fingerprint`, `./dag`, `./resolver`, `./federation`, `./resolution`, `./config`, `./cli/init`, …) keep their names and type surfaces; `./config` consumers are unaffected (barrel re-exports the identical surface). Behavior-preserving throughout: same merge semantics, same exit codes, same login matrix, same build/deploy leg sequencing — pinned by the existing suites.
