---
"every-plugin": minor
---

Declare the shipped surface's real runtime dependencies

Under Bun's `bun` export condition (and node's `development` condition), every-plugin resolves from source, so every value import in the shipped `src` graph is a runtime dependency — and the build surface (`build/ui`, `build/rspack`, `ui/manifest-generator`, `dev`) is part of that graph. The following were resolvable only through hoisting luck or misdeclared as peers and are now proper `dependencies`:

- `@tanstack/router-generator` (was undeclared entirely — crashed at boot once the image's node_modules was pruned)
- `@module-federation/rsbuild-plugin` (was a peer; value-imported by `build/ui/rsbuild-config.ts`)
- `sirv` (was undeclared; used by `dev/serve.ts`)
- `@rsbuild/core`, `@rsbuild/plugin-react`, `@tanstack/router-plugin` (were peers; value-imported by the build/ui factories)

`@rspack/core` stays a peer — its imports in the shipped surface are type-only.
