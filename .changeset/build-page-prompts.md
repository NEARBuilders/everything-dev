---
"ui": patch
"@everything-dev/auth-plugin": patch
---

Add a public /build page with the NEAR AI Cloud and NEAR Intents copy-paste prompts, and link it from the sidebar.

- New `/build` route in the core UI (`_public`) with a "Ready to start building?" header and copy-to-clipboard prompt cards (NEAR AI Cloud private inference, NEAR Intents 1Click).
- Sidebar gains a "Build" item in the main section, visible to signed-out visitors too.
- Onboarding completion screen now points to `/build` with a CTA instead of inlining the prompts; prompt test ids moved from `onboard.prompt-*` to `build.prompt-*`.
