---
"everything-dev": patch
---

Harden the #119/#120/#121 landing train: `bos login` registers the credential handoff before the browser can reach the callback (fixes a race that silently dropped the credential) and delivers it via loopback POST instead of URL query (the minted API key no longer appears in browser history), `bos publish --wallet` no longer constructs a dummy signing strategy, generated rspack configs skip `withPluginDeploy` when no `bos.config.json` is reachable and reuse the single shared config-path walker, and UI route grafting shallow-copies plugin subtree roots so cached plugin trees can be recomposed under different mounts.
