---
"every-plugin": major
"host": minor
"ui": minor
"api": minor
"@everything-dev/apps-plugin": minor
"@everything-dev/auth-plugin": minor
"@everything-dev/proposals-plugin": minor
"@everything-dev/votes-plugin": minor
"@every-plugin/template": minor
"everything-dev": minor
---

Upgrade build toolchain to Rspack 2.2 / Rsbuild 2.2 / Module Federation 2.9

Version catalog bumps: @rspack/core + @rspack/cli → 2.2.6, @rsbuild/core → 2.2.8,
@rsbuild/plugin-react → 2.1.0, @module-federation/* → latest 2.x (enhanced 2.9.0,
node 2.7.50). @module-federation/runtime-tools and @rspack/dev-server are now
explicit dependencies where used.

BREAKING (every-plugin): EveryPluginDevServer removed from every-plugin/build/rspack.
Plugin dev serving is now standalone — `every-plugin-serve` (supervised
`rspack build --watch` + plain node:http server with the same contract: health,
remoteEntry statics, oRPC RPC/OpenAPI, sibling composition, effect context).
Plugin dev scripts use `every-plugin-serve` instead of `rspack serve`.
EveryPluginBuild carries the build-side responsibilities only.

Deploy note: `bos mf check` compares host and remote pluginVersion exactly, so
after the 2.9.0 host deploys, remote-only plugins must be redeployed on
Module Federation 2.9.0 to stay compatible.
