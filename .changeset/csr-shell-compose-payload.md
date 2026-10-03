---
"everything-dev": minor
---

Serve a client compose payload on the no-SSR client shell so CSR deployments compose plugin UI routes. Previously `runtimeConfig.ui.compose` was only embedded when SSR rendered the page, so default `bos dev` (no `--ssr`) and any CSR-only runtime (no `ui.ssr`) fell back to the bundled core-only route tree — plugin routes like the auth plugin's `/login` were absent and dynamic core routes (`_public/$accountId`) swallowed the path instead. The shell now embeds the same manifests + digest + plugin web entries the SSR path uses (built without touching MF loaders); when no plugin declares a ui, or the payload cannot be built (warn-logged), the shell keeps the bundled core-only tree.
