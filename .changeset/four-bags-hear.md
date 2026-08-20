---
---

Add a `backcompat` regression test mode (`bun run test:regression:backcompat`) that boots a local host while loading the last published UI/API/plugin bundles via Module Federation, verifying the new host works against existing published bundles. Regression commands (`dev`, `prod`, `backcompat`) now run both HTTP and browser suites each time instead of stopping when the HTTP suite fails.
