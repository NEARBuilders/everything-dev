---
"everything-dev": patch
---

Children can now author the ADR 0034 `platform: "<framework-version>"` pin in `bos.app.ts`: `AppDescriptorSchema` accepts it and the authored↔resolved round-trip (`toConfigInput` / `configInputToDescriptor` / the `bos.app.ts` serializer) carries it, so sync no longer strips the pin and exact-pin ("exact-or-loud") semantics are reachable (#520).
