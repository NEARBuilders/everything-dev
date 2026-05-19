---
"host": patch
"ui": patch
---

Move the homepage BOS viewer into an isolated iframe surface backed by a host-rendered `/_viewer` page.

- Update `ui/src/routes/_layout/index.tsx` to load the landing viewer through `/_viewer` while preserving `?path=` support.
- Add a dedicated host-rendered `/_viewer` endpoint with scoped CSP framing rules so the viewer can run in production without weakening the rest of the app.
- Bootstrap the NEAR BOS web component from the host page so the requested widget path is forwarded correctly into the viewer runtime.
