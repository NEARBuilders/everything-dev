---
"every-plugin": patch
---

Fix born-incomplete plugin bundles under rspack 2.x: the composition disables
`optimization.splitChunks`, which re-ids the final chunk graph while the
federation get-factory codegen keeps pre-split ids — emitted entries then
eagerly load chunks that were never emitted, failing at load time with
`__webpack_modules__[r] is not a function`. A new `ChunkCompletenessPlugin`
fails the build loudly if any entry references an unemitted chunk, so the
regression can never ship silently again.
