---
"every-plugin": patch
---

Fix plugin load failures under rspack 2.2.8 + MF runtime 2.9.x ("__webpack_modules__[r] is not a function"):

- The build composition disables `optimization.splitChunks`, which re-ids the
  final chunk graph while the federation get-factory codegen keeps pre-split
  ids — emitted container entries then eagerly load chunks that were never
  emitted. A new `ChunkCompletenessPlugin` fails the build loudly if any entry
  references an unemitted chunk, so the regression can never ship silently.
- The runtime service now registers and loads remotes under the container's
  own name (`mf-manifest.json` metaData.name). The node runtime's chunk
  loader falls back to resolving chunk URLs from the remote's entry URL keyed
  by that self name; a mismatch made the fallback miss, `resolveUrl` return
  null, and the loader hand back an empty chunk as if it had loaded — the
  exposed module then required ids nothing registered. An integration test
  registers the fixture under a mismatched alias key to pin this.
