---
"everything-dev": minor
---

`bos types gen` emits the composition inventory — the runtime map (#594)

Every types-gen run now also generates the effective route tree: `.bos/generated/runtime-map.json` (machine/human inventory: sources, mounts, routes with owners + full paths, shadowed claims, unresolved sources) and `ui/src/lib/runtime-map.gen.ts` (typed `REMOTE_ROUTES` / `RemotePath` unions). It is a static model of `constructTree` — core-wins precedence applied, peer collisions thrown — so "does this app have /login? who owns /settings?" is answerable without reverse-engineering the runtime compose. Local manifests are freshly generated; remote ones fetch from the published `<ui>/manifest.gen.json`. `bos types gen` degrades strictly (an unresolvable remote fails the run — typecheck catches upstream renames); dev/build/train paths warn and continue. `BOS_MAP_ALLOW_UNRESOLVED=1` for offline work.
