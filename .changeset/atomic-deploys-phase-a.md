---
"every-plugin": minor
"everything-dev": minor
---

Atomic deploys phase A (tickets 01-02 of .scratch/atomic-deploys): builds emit content-hashed entrypoints (`remoteEntry.[contenthash].js`, `remoteEntry.server.[contenthash].js`), immutable hashed `mf-manifest.json` and `style.css` copies, and a per-dist `build-report.json` for the deploy leg — fixed-name entry aliases are fully retired (hard break; dev servers keep the fixed dev names as the dev serving contract). Bundle cache classification now treats any content-hashed name as immutable regardless of base name. New `every-plugin/version-manifest` export defines the immutable per-deploy `WorkspaceVersionManifest` document, and config slots accept a `manifest` pointer (versioned manifest filename) — the deploy unit for atomic, additive deploys.
