---
"everything-dev": patch
---

Config resolution rewritten around an explicit ResolutionSession: `openResolution()` / `fromParts()` replace the process-global config cache and its suppress/drain/resume warning protocol. All bos commands now thread the session explicitly; warnings from config resolution print instead of being silently dropped on some paths; `bos dev` with no config fails before the install/build steps instead of after; `--config-path` boots stage artifacts beside the config file; circular `extends` errors are tagged and carry the full chain for both local and remote chains.
