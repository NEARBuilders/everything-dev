---
"every-plugin": minor
"everything-dev": minor
"ui": minor
---

The core ui's bootstrap stubs are now generated, not authored: the web entry, hydrate bootstrap, SSR router module, compose expose, and globals are emitted as `.gen`-suffixed, gitignored files by the framework's code-artifact generation pass (`bos dev`/`build`/`typecheck`), regenerated from the installed package version. The build surface retargets to the generated paths and core-ui detection no longer requires an entry stub. Sync drops the retired stub files from its ownership list and tolerates templates that no longer ship a file. Per ADR 0023.
