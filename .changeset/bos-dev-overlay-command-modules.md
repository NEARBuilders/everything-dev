---
"everything-dev": minor
---

`bos dev` reads the `bos.app.ts`/`bos.dev.ts` pair: development opens pick up a root `bos.dev.ts` overlay (a `Partial<AppDescriptor>`, child-wins, never published); malformed overlays fail loudly naming the file. CLI internals: plugin.ts decomposed into per-command modules, the dev/start result carries session data (pendingSession channel deleted), `keyPublish` prompts via the shell (additive `removeOldKeys` input, piped-stdin defaults to Y as before), and the init flow fetches the parent config once.
