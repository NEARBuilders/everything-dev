---
"everything-dev": patch
---

Fix the scaffolded child api template (`.github/templates/api/`): the slim shell declared only the `API_DATABASE_URL` secret while `plugin.dev.ts` also wrote `BETTER_AUTH_SECRET` (a secrets-vault concern only the platform root's api consumes), and the shell's `initialize` passed the connection string where `DatabaseLive` expects the plugin config object. Fresh `bos init` children with an api override now typecheck against the live root's published contracts — surfaced by the init.full integration gate after ticket 04 repointed its parent to the production root (the previously stale deployed auth contract had been self-skipping that assertion).
