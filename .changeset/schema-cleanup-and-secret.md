---
"api": patch
"everything-dev": patch
---

Clean up InfraDatabaseSchema, implement `secret` field, deduplicate `isPlainObject`

- **Remove `schemaMode` from `InfraDatabaseSchema`** — schema isolation (`search_path`) is handled at the driver layer in `api/src/db/layer.ts`, not in the Docker compose infra layer. Having it in both places was misleading
- **Implement `secret` field** — when a per-plugin record specifies `secret = "CUSTOM_DB_URL"`, that env var name is used instead of the conventional `{PLUGIN}_DATABASE_URL`. Falls back to conventional naming when absent
- **Import `isPlainObject` from `../merge`** in `cli/infra.ts` instead of redefining it locally
- **Update `alchemy.ts`** to no longer reference `schemaMode` — replaces the broken inline ternary with a driver-layer isolation comment
- **Update all test fixtures** to remove `schemaMode` from test data across `infra.test.ts` and `toml-config-pipeline.test.ts`
- **Add 2 tests** for `secret` field: custom secret name resolution and conventional fallback
