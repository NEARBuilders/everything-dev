---
"every-plugin": minor
---

Plugin workspaces can append rspack plugins from `build.config.ts` via the new
`extraPlugins` option — instances are appended after the composed defaults
(manifest emission, build reporting, data-URI fix) and run in both build and
watch. This is the sanctioned escape hatch for build-time integrations such as
content pipelines.
