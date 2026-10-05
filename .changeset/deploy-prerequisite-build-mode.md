---
"everything-dev": patch
---

Deploy prerequisite builds run in the deploy build mode. `ensureFreshDeps`' children (the prerequisite train) now receive the same `DEPLOY=true` / `NODE_ENV=production` env as the target builds they precede — previously they ran with the invoking shell's ambient env, so a bundler-config workspace in the prerequisite closure (host, force-rebuilt via the registry plugin's dependency edge) loaded its rsbuild config in source-first mode and died in jiti before any output. The build-mode contract now lives at one seam: `buildWorkspaceTargets` builds the env once and both the prerequisite loop and the target loops receive it. Also drops the vestigial `"host": "workspace:*"` devDependency from `plugins/registry` — nothing imports host; it only dragged host into every deploy's prerequisite closure for a doomed duplicate build.
