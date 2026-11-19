---
"everything-dev": patch
---

deploy-history wire: expose the deploy-record schema and FastKV fetchers

New export subpath `everything-dev/registry/fastkv` re-exports the registry fetchers (`fetchDeployManifests` et al.) so consumers read deploy history through the typed key model instead of hand-built key strings. The train's per-deploy record (`DeployRecordSchema`, `PlatformManifestPinSchema`, `deployRecordTsOf`) now composes through `packages/everything-dev/src/services/registry/deploy-record.ts`, making the written record shape and the reader share one derivation per wire rule (ADR 0040). The api's `/deploys` reader is repaired to the post-Nov-3 layout: deploy records from `apps/<a>/<g>/deploys/<ts>.json`, release pins from the version record with thin-tag fallback, and `releaseVersion` carried alongside `imageRef` for digest resolution.
