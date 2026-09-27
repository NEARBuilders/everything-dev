---
"everything-dev": patch
"ui": patch
"host": patch
"api": patch
"@everything-dev/apps-plugin": patch
---

Build output hardening for the platform deploy path.

- Show all stdout during deploy builds (not just chunks matching a provider regex). Chunks can split across boundaries so a filtered URL never matched — deploy builds now pass all stdout through unconditionally.
- Extract build-result classification as a pure function from the build attempt, making the exit-code classification testable without spawning processes.
- Fix variable shadowing where inner `const result` shadowed the outer `await run(...)` binding.
- Remove the unnecessary per-workspace env copy.
