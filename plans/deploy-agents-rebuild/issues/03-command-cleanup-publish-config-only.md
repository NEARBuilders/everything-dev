# 03: Command cleanup — publish config-only, build loses its deploy flag

**What to build:** With the full train living in `bos deploy`, remove the overlapping
entry points: `bos publish` slims to config-only (republish the config to FastKV and
confirm — no building); the deploy flag is removed from the build command; the root
deploy script and the scripts scaffolded into child projects point at the deploy
command; command metadata, option schemas, result schemas, and result printing are
updated to match.

**Blocked by:** 02 (bos deploy — the full train).

**Status:** ready-for-agent

- [ ] `bos publish` never builds; a config-only republish works and confirms
- [ ] Build command has no deploy flag; all callers updated
- [ ] Root deploy script runs the consolidated deploy command
- [ ] Freshly scaffolded child projects get the consolidated deploy script
- [ ] Help text and command metadata match the new surface
- [ ] The CLI breaking change is recorded for a changeset
