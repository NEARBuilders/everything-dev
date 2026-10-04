# 05: Docs, changesets, secrets, staging E2E

**What to build:** Make the consolidated flow the only documented flow: update the agent
instructions (deploy command, self-deploy walkthrough, workflow descriptions, removed
commands), add the changeset for the CLI breaking change, add the storage API key to the
repo secrets so the CDN upload path is live in CI, and prove the whole thing with one
full live staging train run.

**Blocked by:** 04 (CI deploy workflow rewrite).

**Status:** ready-for-agent

- [ ] Agent instructions describe only the consolidated flow; zero references to removed commands/flags
- [ ] Changeset added for the framework package (breaking CLI change)
- [ ] Storage API key present in repo secrets; CDN upload exercised by a CI deploy
- [ ] One staging train ran green end-to-end: build → upload → publish → image → Railway → mf check → smoke
- [ ] Production deploy verified on the next merge to main
